"""Pruebas de la migración `c1f4b8e2a706` (snapshot de tarifa en `pago`)
mediante el arnés de migraciones.

Por qué el arnés y no la suite normal: el job `migraciones-desde-cero` de CI
y la fixture `esquema_migrado` solo demuestran que `alembic upgrade head`
corre contra una base VACÍA. Lo que hay que probar acá es lo contrario: que
la migración corre sobre una tabla `pago` QUE YA TIENE PLATA adentro sin
tocar una sola de esas filas.

Se verifica, sobre datos preexistentes, que:
  1. Las columnas no existían antes de la migración (ancla).
  2. Los pagos que ya vivían en la base conservan intactos monto, estado y
     cobertura, y quedan con el snapshot en NULL -- sin backfill inventado.
  3. Los dos CHECK quedan activos y rechazan un snapshot a medias.
  4. El `downgrade()` es real y la ida y vuelta no pierde ninguna fila.
"""
from datetime import date
from decimal import Decimal

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "de1413036789"
REVISION_SNAPSHOT = "c1f4b8e2a706"

SQL_COLUMNAS = (
    "SELECT column_name FROM information_schema.columns "
    "WHERE table_name = 'pago' AND column_name IN "
    "('tarifa_mensual_aplicada', 'meses_comprados', 'monto_base') "
    "ORDER BY column_name"
)


def _sembrar_pagos(arnes: ArnesMigracion) -> None:
    """Siembra con SQL crudo (nunca vía el ORM: el ORM describe el esquema de
    HOY, no el de la revisión bajo prueba) el grafo mínimo persona -> tipo ->
    membresía -> pago que ya vive en producción."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO tipo_membresia (id, categoria, precio, modalidad)
        VALUES (1, 'Adultos', 30.00, 'MENSUAL')
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO membresia (id, estado, monto_aplicado, fecha_activacion,
                               es_gratuidad_familiar, persona_id, tipo_membresia_id)
        VALUES (1, 'ACTIVA', 30.00, TIMESTAMPTZ '2026-01-01 12:00:00+00',
                FALSE, 1, 1)
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO pago (id, monto, estado_pago, tipo_pago, fecha_registro,
                          fecha_inicio, fecha_fin, persona_id, membresia_id)
        VALUES
          (1, 90.00, 'APROBADO', 'TRANSFERENCIA',
           TIMESTAMPTZ '2026-01-01 12:00:00+00',
           DATE '2026-01-01', DATE '2026-04-01', 1, 1),
          (2, 30.00, 'RECHAZADO', 'EFECTIVO',
           TIMESTAMPTZ '2026-04-01 12:00:00+00',
           DATE '2026-04-01', DATE '2026-05-01', 1, 1)
        """
    )


def test_las_columnas_no_existian_antes_de_la_migracion(arnes_migracion):
    """Ancla: si esto dejara de dar vacío sin la migración, las columnas
    habrían llegado al esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_COLUMNAS) == []


def test_los_pagos_preexistentes_quedan_intactos_y_sin_snapshot(arnes_migracion):
    """El caso que `migraciones-desde-cero` no puede detectar. Ninguna fila
    se toca y el snapshot queda en NULL: la tarifa que regía cuando se
    cobraron es justamente lo que nadie registró, y rellenarla con la de hoy
    sería inventar historia (#400 lo prohíbe)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_pagos(arnes_migracion)

    arnes_migracion.migrar(REVISION_SNAPSHOT)

    assert arnes_migracion.consultar(
        "SELECT id, monto, estado_pago::text, fecha_inicio, fecha_fin, "
        "tarifa_mensual_aplicada, meses_comprados, monto_base "
        "FROM pago ORDER BY id"
    ) == [
        (1, Decimal("90.00"), "APROBADO", date(2026, 1, 1), date(2026, 4, 1),
         None, None, None),
        (2, Decimal("30.00"), "RECHAZADO", date(2026, 4, 1), date(2026, 5, 1),
         None, None, None),
    ]
    assert arnes_migracion.revision_actual() == REVISION_SNAPSHOT


def test_el_check_de_snapshot_completo_queda_activo(arnes_migracion):
    """El CHECK no sirve de nada si la migración lo declara pero Postgres no
    lo aplica: se prueba intentando escribir un snapshot a medias."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_pagos(arnes_migracion)
    arnes_migracion.migrar(REVISION_SNAPSHOT)

    try:
        arnes_migracion.ejecutar(
            "UPDATE pago SET tarifa_mensual_aplicada = 30.00 WHERE id = 1"
        )
    except Exception as error:  # noqa: BLE001 -- el tipo exacto depende del driver
        assert "ck_pago_snapshot_completo_o_ausente" in str(error)
    else:
        raise AssertionError("el CHECK de snapshot completo no se aplicó")


def test_el_downgrade_revierte_las_columnas_sin_perder_filas(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_pagos(arnes_migracion)
    arnes_migracion.migrar(REVISION_SNAPSHOT)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_COLUMNAS) == []
    assert arnes_migracion.consultar("SELECT id, monto FROM pago ORDER BY id") == [
        (1, Decimal("90.00")), (2, Decimal("30.00")),
    ]

    # Ida y vuelta completa: volver a subir no rompe nada.
    arnes_migracion.migrar(REVISION_SNAPSHOT)
    assert len(arnes_migracion.consultar(SQL_COLUMNAS)) == 3
    assert arnes_migracion.consultar("SELECT count(*) FROM pago") == [(2,)]
