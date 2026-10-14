"""
Pruebas de la migración `z1768pagoautodeclarado` (agrega `pago.autodeclarado`,
#1768 S10) mediante el arnés de migraciones.

La columna es aditiva y NULLABLE sin backfill: los pagos que ya viven en la
base quedan con origen desconocido (NULL) y nunca se anulan solos. Se verifica,
sobre datos preexistentes, que la migración no toca nada y que el `downgrade()`
es real.
"""
from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "z1749miembrodesde"
REVISION_AUTODECLARADO = "z1768pagoautodeclarado"

SQL_COLUMNA = (
    "SELECT column_name, is_nullable, column_default FROM information_schema.columns "
    "WHERE table_name = 'pago' AND column_name = 'autodeclarado'"
)


def _sembrar_pago(arnes: ArnesMigracion) -> None:
    """SQL crudo: el ORM describe el esquema de HOY, no el de la revisión."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        "INSERT INTO tipo_membresia (id, categoria, precio, modalidad, activo) "
        "VALUES (1, 'Adultos', 25.00, 'MENSUAL', true)"
    )
    arnes.ejecutar(
        "INSERT INTO membresia (id, estado, monto_aplicado, fecha_activacion, persona_id, "
        "tipo_membresia_id, es_gratuidad_familiar) VALUES (1, 'ACTIVA', 25.00, "
        "TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, 1, FALSE)"
    )
    arnes.ejecutar(
        "INSERT INTO pago (id, monto, estado_pago, tipo_pago, fecha_registro, fecha_inicio, "
        "fecha_fin, persona_id, membresia_id) VALUES (1, 25.00, 'PENDIENTE_VALIDACION', 'EFECTIVO', "
        "TIMESTAMPTZ '2024-03-02 12:00:00+00', DATE '2024-03-01', DATE '2024-03-31', 1, 1)"
    )


def test_la_revision_sigue_en_una_unica_cadena():
    """Una sola cabeza (la migración se encadena sobre la anterior)."""
    script = ScriptDirectory.from_config(AlembicConfig("alembic.ini"))
    assert len(script.get_heads()) == 1
    assert REVISION_AUTODECLARADO in {r.revision for r in script.walk_revisions()}
    assert script.get_revision(REVISION_AUTODECLARADO).down_revision == REVISION_ANTERIOR


def test_la_columna_no_existia_antes_de_la_migracion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_COLUMNA) == []


def test_los_pagos_preexistentes_quedan_con_origen_desconocido(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_pago(arnes_migracion)

    arnes_migracion.migrar(REVISION_AUTODECLARADO)

    assert arnes_migracion.consultar("SELECT id, estado_pago, autodeclarado FROM pago") == [
        (1, "PENDIENTE_VALIDACION", None),
    ]
    assert arnes_migracion.consultar(SQL_COLUMNA) == [("autodeclarado", "YES", None)]
    assert arnes_migracion.revision_actual() == REVISION_AUTODECLARADO


def test_downgrade_y_upgrade_hacen_ida_y_vuelta(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_pago(arnes_migracion)
    arnes_migracion.migrar(REVISION_AUTODECLARADO)

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_COLUMNA) == []
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR

    arnes_migracion.migrar(REVISION_AUTODECLARADO)
    assert arnes_migracion.consultar("SELECT id, autodeclarado FROM pago") == [(1, None)]
