"""Pruebas de la migración `8a92e4d44591` (crear `correccion_pago`, issue
#400 slice 5b) mediante el arnés de migraciones.

El riesgo propio de ESTA migración es el CHECK `ck_correccion_pago_algun_
campo_cambia`: que `test_no_hay_drift_entre_modelos_y_migraciones` compare
bien contra `Base.metadata` no prueba que Postgres lo haga cumplir de
verdad sobre un INSERT real -- mismo criterio que
`test_migracion_cobertura_bonificada.py` con su restricción de exclusión.

Se verifica, sobre datos preexistentes, que:
  1. Ni la tabla ni el tipo enum `efectocoberturacorreccion` existían antes.
  2. `persona`, `tipo_membresia`, `membresia` y `pago` que ya vivían en la
     base sobreviven intactos.
  3. El CHECK rechaza en Postgres una fila donde ningún par anterior/nuevo
     difiere, pero permite una donde al menos uno sí.
  4. `downgrade()` borra la tabla y el tipo enum sin tocar el resto del grafo.
"""
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "fbd783a457d3"
REVISION_CORRECCION = "8a92e4d44591"

SQL_TABLA = (
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_name = 'correccion_pago'"
)
SQL_TIPO_ENUM = (
    "SELECT typname FROM pg_type WHERE typname = 'efectocoberturacorreccion'"
)


def _sembrar_grafo(arnes: ArnesMigracion) -> None:
    """SQL crudo, nunca el ORM: el ORM describe el esquema de HOY, no el de
    la revisión bajo prueba. Persona (1, admin) + Persona (2, socio) +
    TipoMembresia (1) + Membresia (1) + Pago (1, APROBADO) -- el grafo
    mínimo que `correccion_pago` referencia por FK."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Admin', 'Club', '1710034065', DATE '1985-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE),
               (2, 'Beto', 'Ruiz', '1710034073', DATE '1992-02-02',
                '0991234568', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        "INSERT INTO tipo_membresia (id, categoria, precio, modalidad) "
        "VALUES (1, 'Adultos', 30.00, 'MENSUAL')"
    )
    arnes.ejecutar(
        """
        INSERT INTO membresia (id, estado, monto_aplicado, fecha_activacion,
                               es_gratuidad_familiar, persona_id, tipo_membresia_id)
        VALUES (1, 'ACTIVA', 30.00, TIMESTAMPTZ '2026-06-01 00:00:00+00',
                FALSE, 2, 1)
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO pago (id, monto, tarifa_mensual_aplicada, meses_comprados,
                          monto_base, estado_pago, tipo_pago, fecha_registro,
                          fecha_validacion, fecha_inicio, fecha_fin,
                          persona_id, membresia_id)
        VALUES (1, 30.00, 30.00, 1, 30.00, 'APROBADO', 'EFECTIVO',
                TIMESTAMPTZ '2026-06-01 12:00:00+00',
                TIMESTAMPTZ '2026-06-01 12:00:00+00',
                DATE '2026-06-01', DATE '2026-06-30', 2, 1)
        """
    )


def _insertar_correccion(arnes: ArnesMigracion, *, monto_anterior: str, monto_nuevo: str) -> None:
    arnes.ejecutar(
        """
        INSERT INTO correccion_pago
            (pago_id, tarifa_mensual_aplicada_anterior, tarifa_mensual_aplicada_nuevo,
             meses_comprados_anterior, meses_comprados_nuevo,
             monto_base_anterior, monto_base_nuevo,
             monto_anterior, monto_nuevo,
             fecha_inicio_anterior, fecha_inicio_nuevo,
             fecha_fin_anterior, fecha_fin_nuevo,
             efecto_cobertura, motivo, actor_persona_id, fecha_registro)
        VALUES
            (1, 30.00, 30.00, 1, 1, 30.00, 30.00,
             CAST(:monto_anterior AS NUMERIC), CAST(:monto_nuevo AS NUMERIC),
             DATE '2026-06-01', DATE '2026-06-01',
             DATE '2026-06-30', DATE '2026-06-30',
             'SIN_CAMBIO', 'motivo de prueba', 1, now())
        """,
        monto_anterior=monto_anterior,
        monto_nuevo=monto_nuevo,
    )


def test_ni_la_tabla_ni_el_tipo_enum_existian_antes(arnes_migracion):
    """Ancla: si esto dejara de fallar sin la migración, habrían llegado al
    esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TABLA) == []
    assert arnes_migracion.consultar(SQL_TIPO_ENUM) == []


def test_grafo_preexistente_sobrevive_la_migracion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_grafo(arnes_migracion)

    arnes_migracion.migrar(REVISION_CORRECCION)

    assert arnes_migracion.consultar(
        "SELECT id, cedula FROM persona ORDER BY id"
    ) == [(1, "1710034065"), (2, "1710034073")]
    assert arnes_migracion.consultar(
        "SELECT id, persona_id, estado FROM membresia"
    ) == [(1, 2, "ACTIVA")]
    assert arnes_migracion.consultar(
        "SELECT id, estado_pago::text, monto FROM pago"
    ) == [(1, "APROBADO", Decimal("30.00"))]
    assert arnes_migracion.consultar(SQL_TABLA) == [("correccion_pago",)]
    assert arnes_migracion.consultar(SQL_TIPO_ENUM) == [("efectocoberturacorreccion",)]
    assert arnes_migracion.revision_actual() == REVISION_CORRECCION


def test_el_check_rechaza_una_correccion_que_no_cambia_ningun_valor(arnes_migracion):
    """El chequeo real: Postgres, no el ORM, debe rechazar una fila donde
    NINGÚN par anterior/nuevo difiere."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_grafo(arnes_migracion)
    arnes_migracion.migrar(REVISION_CORRECCION)

    with pytest.raises(IntegrityError, match="ck_correccion_pago_algun_campo_cambia"):
        _insertar_correccion(arnes_migracion, monto_anterior="30.00", monto_nuevo="30.00")

    assert arnes_migracion.consultar(
        "SELECT count(*) FROM correccion_pago"
    ) == [(0,)]


def test_el_check_permite_una_correccion_que_cambia_al_menos_un_valor(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_grafo(arnes_migracion)
    arnes_migracion.migrar(REVISION_CORRECCION)

    _insertar_correccion(arnes_migracion, monto_anterior="30.00", monto_nuevo="45.00")

    assert arnes_migracion.consultar(
        "SELECT count(*) FROM correccion_pago"
    ) == [(1,)]


def test_el_downgrade_borra_la_tabla_y_el_tipo_sin_tocar_el_resto_del_grafo(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_grafo(arnes_migracion)
    arnes_migracion.migrar(REVISION_CORRECCION)
    _insertar_correccion(arnes_migracion, monto_anterior="30.00", monto_nuevo="45.00")

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TABLA) == []
    assert arnes_migracion.consultar(SQL_TIPO_ENUM) == []
    assert arnes_migracion.consultar(
        "SELECT id, cedula FROM persona ORDER BY id"
    ) == [(1, "1710034065"), (2, "1710034073")]
    assert arnes_migracion.consultar(
        "SELECT id, estado_pago::text FROM pago"
    ) == [(1, "APROBADO")]
