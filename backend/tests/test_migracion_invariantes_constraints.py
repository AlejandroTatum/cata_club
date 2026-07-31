"""
Pruebas de la migración `c3d9f2b7a1e5` (índices únicos parciales de los
invariantes de negocio, issue #8) mediante el arnés de migraciones.

Lo que `migraciones-desde-cero` no puede detectar: una base que YA viola un
invariante (dos pagos PENDIENTE_VALIDACION para la misma membresía, o dos
membresías ACTIVAS para la misma persona). `CREATE UNIQUE INDEX` fallaría de
todos modos, pero con un error de Postgres que no le dice al operador QUÉ
filas arreglar. La migración pre-chequea y falla RUIDOSAMENTE con las filas
en conflicto y la instrucción de resolverlas a mano -- no deduplica sola:
decidir cuál pago se aprueba/rechaza o cuál membresía sigue activa es una
decisión de negocio, no algo que una migración deba adivinar (no existe en el
repo ninguna migración previa que deduplique datos; este es el criterio que
se fija).

Se verifica, sobre datos preexistentes, que:
  1. Los índices no existían antes de la migración (ancla).
  2. Con datos limpios, el upgrade crea ambos índices únicos parciales y las
     filas sobreviven intactas.
  3. Con datos sucios (cada invariante por separado), el upgrade falla con un
     mensaje accionable y la base queda en la revisión anterior.
  4. El `downgrade()` es real: la ida y vuelta funciona.
"""
import pytest

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "e1b7c40d2f95"
REVISION_CONSTRAINTS = "c3d9f2b7a1e5"

SQL_INDICES = (
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' "
    "AND indexname IN ('uq_pago_pendiente_por_membresia', "
    "'uq_membresia_activa_por_persona') ORDER BY indexname"
)


def _sembrar_base(arnes: ArnesMigracion) -> None:
    """Personas, tipo de membresía y membresías con SQL crudo (nunca vía el
    ORM: el ORM describe el esquema de HOY, no el de la revisión bajo
    prueba)."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES
          (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
           '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE),
          (2, 'Beto', 'Salas', '1710034073', DATE '1992-06-10',
           '0997654321', TIMESTAMPTZ '2024-04-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO tipo_membresia (id, categoria, franja_horaria, precio, modalidad)
        VALUES (1, 'Adultos', '18:00-19:00', 30.00, 'MENSUAL')
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO membresia (id, estado, monto_aplicado, fecha_activacion,
                               es_gratuidad_familiar, persona_id, tipo_membresia_id)
        VALUES
          (1, 'ACTIVA', 30.00, TIMESTAMPTZ '2026-07-01 00:00:00+00', FALSE, 1, 1),
          (2, 'INACTIVA', 30.00, TIMESTAMPTZ '2026-07-01 00:00:00+00', FALSE, 2, 1)
        """
    )


def _sembrar_pago(arnes: ArnesMigracion, pago_id: int, membresia_id: int,
                  estado: str) -> None:
    arnes.ejecutar(
        f"""
        INSERT INTO pago (id, monto, estado_pago, tipo_pago, fecha_registro,
                          fecha_inicio, fecha_fin, persona_id, membresia_id)
        VALUES ({pago_id}, 30.00, '{estado}', 'EFECTIVO',
                TIMESTAMPTZ '2026-07-01 12:00:00+00',
                DATE '2026-07-01', DATE '2026-07-31', 2, {membresia_id})
        """
    )


def test_los_indices_no_existian_antes_de_la_migracion(arnes_migracion):
    """Ancla: si esta prueba dejara de fallar sin la migración, los índices
    habrían llegado al esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_INDICES) == []


def test_upgrade_con_datos_limpios_crea_ambos_indices_parciales(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_base(arnes_migracion)
    _sembrar_pago(arnes_migracion, 1, 2, "PENDIENTE_VALIDACION")
    _sembrar_pago(arnes_migracion, 2, 2, "APROBADO")

    arnes_migracion.migrar(REVISION_CONSTRAINTS)

    assert arnes_migracion.consultar(SQL_INDICES) == [
        ("uq_membresia_activa_por_persona",),
        ("uq_pago_pendiente_por_membresia",),
    ]
    # Únicos y parciales de verdad (el WHERE es el espejo del chequeo de
    # servicio correspondiente).
    definiciones = dict(arnes_migracion.consultar(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' "
        "AND indexname IN ('uq_pago_pendiente_por_membresia', "
        "'uq_membresia_activa_por_persona')"
    ))
    assert "UNIQUE" in definiciones["uq_pago_pendiente_por_membresia"]
    assert "PENDIENTE_VALIDACION" in definiciones["uq_pago_pendiente_por_membresia"]
    assert "UNIQUE" in definiciones["uq_membresia_activa_por_persona"]
    assert "ACTIVA" in definiciones["uq_membresia_activa_por_persona"]
    # Los datos preexistentes sobrevivieron intactos.
    assert arnes_migracion.consultar(
        "SELECT id, estado FROM membresia ORDER BY id"
    ) == [(1, "ACTIVA"), (2, "INACTIVA")]
    assert arnes_migracion.revision_actual() == REVISION_CONSTRAINTS


def test_upgrade_con_dos_pagos_pendientes_duplicados_falla_ruidosamente(
    arnes_migracion,
):
    """Una base que ya viola el invariante 1 no debe migrar en silencio ni
    con un error críptico: el pre-chequeo aborta nombrando las membresías en
    conflicto, y la base queda en la revisión anterior."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_base(arnes_migracion)
    _sembrar_pago(arnes_migracion, 1, 2, "PENDIENTE_VALIDACION")
    _sembrar_pago(arnes_migracion, 2, 2, "PENDIENTE_VALIDACION")

    with pytest.raises(RuntimeError, match="pago.*PENDIENTE_VALIDACION"):
        arnes_migracion.migrar(REVISION_CONSTRAINTS)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_INDICES) == []


def test_upgrade_con_dos_membresias_activas_duplicadas_falla_ruidosamente(
    arnes_migracion,
):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_base(arnes_migracion)
    arnes_migracion.ejecutar(
        """
        INSERT INTO membresia (id, estado, monto_aplicado, fecha_activacion,
                               es_gratuidad_familiar, persona_id, tipo_membresia_id)
        VALUES (3, 'ACTIVA', 30.00, TIMESTAMPTZ '2026-07-02 00:00:00+00', FALSE, 1, 1)
        """
    )

    with pytest.raises(RuntimeError, match="membres.*ACTIVA"):
        arnes_migracion.migrar(REVISION_CONSTRAINTS)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_INDICES) == []


def test_downgrade_y_upgrade_hacen_ida_y_vuelta(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_base(arnes_migracion)
    arnes_migracion.migrar(REVISION_CONSTRAINTS)

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_INDICES) == []
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR

    arnes_migracion.migrar(REVISION_CONSTRAINTS)
    assert len(arnes_migracion.consultar(SQL_INDICES)) == 2
