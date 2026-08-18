"""Pruebas de la migración `d2a7e5c91b34` (`SUSPENDIDA` + historial de
estado de membresía) mediante el arnés de migraciones.

El riesgo propio de esta migración es el `ALTER TYPE ... ADD VALUE` sobre un
enum QUE YA ESTÁ EN USO: si fallara, las membresías existentes quedarían sin
poder leerse. El job `migraciones-desde-cero` no puede detectarlo porque
corre contra una base vacía, donde el enum no tiene filas que lo usen.

Se verifica, sobre datos preexistentes, que:
  1. Ni la tabla ni el label existían antes (ancla).
  2. Las membresías que ya vivían en la base sobreviven intactas y el label
     nuevo queda disponible.
  3. El `downgrade()` borra la tabla sin tocar `membresia`.
"""
from decimal import Decimal

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "c1f4b8e2a706"
REVISION_HISTORIAL = "d2a7e5c91b34"

SQL_TABLA = (
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_name = 'historial_estado_membresia'"
)
SQL_LABELS = (
    "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid "
    "WHERE typname = 'estadomembresia' ORDER BY enumlabel"
)


def _sembrar_membresias(arnes: ArnesMigracion) -> None:
    """SQL crudo, nunca el ORM: el ORM describe el esquema de HOY, no el de
    la revisión bajo prueba."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
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
        VALUES (1, 'ACTIVA', 30.00, TIMESTAMPTZ '2026-01-01 12:00:00+00', FALSE, 1, 1)
        """
    )


def test_ni_la_tabla_ni_el_label_existian_antes(arnes_migracion):
    """Ancla: si esto dejara de fallar sin la migración, habrían llegado al
    esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TABLA) == []
    assert ("SUSPENDIDA",) not in arnes_migracion.consultar(SQL_LABELS)


def test_las_membresias_preexistentes_sobreviven_y_el_label_queda_disponible(arnes_migracion):
    """El caso que `migraciones-desde-cero` no puede detectar: el
    `ALTER TYPE` corre sobre un enum que YA tiene filas usándolo."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_membresias(arnes_migracion)

    arnes_migracion.migrar(REVISION_HISTORIAL)

    assert arnes_migracion.consultar(
        "SELECT id, estado::text, monto_aplicado FROM membresia ORDER BY id"
    ) == [(1, "ACTIVA", Decimal("30.00"))]
    assert ("SUSPENDIDA",) in arnes_migracion.consultar(SQL_LABELS)
    assert arnes_migracion.consultar(SQL_TABLA) == [("historial_estado_membresia",)]
    assert arnes_migracion.revision_actual() == REVISION_HISTORIAL


def test_una_membresia_puede_pasar_a_suspendida_despues_de_migrar(arnes_migracion):
    """El label no sirve de nada si Postgres no lo acepta en un UPDATE
    real."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_membresias(arnes_migracion)
    arnes_migracion.migrar(REVISION_HISTORIAL)

    arnes_migracion.ejecutar("UPDATE membresia SET estado = 'SUSPENDIDA' WHERE id = 1")

    assert arnes_migracion.consultar("SELECT estado::text FROM membresia") == [
        ("SUSPENDIDA",)
    ]


def test_el_downgrade_borra_la_tabla_sin_tocar_membresia(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_membresias(arnes_migracion)
    arnes_migracion.migrar(REVISION_HISTORIAL)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TABLA) == []
    assert arnes_migracion.consultar("SELECT id, estado::text FROM membresia") == [
        (1, "ACTIVA")
    ]
    # El label NO se revierte: PostgreSQL no permite quitar un valor de un
    # enum. Queda documentado como comportamiento esperado, no como olvido.
    assert ("SUSPENDIDA",) in arnes_migracion.consultar(SQL_LABELS)
