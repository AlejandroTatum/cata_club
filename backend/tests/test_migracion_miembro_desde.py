"""
Migración `z1749miembrodesde` (issue #1749): `persona.miembro_desde`, una
columna `DATE` NULLABLE, aditiva y SIN backfill. Las personas que ya viven en
la base quedan con `NULL` -- nunca con `fecha_registro` ni nada derivado.
"""
from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory

from tests.arnes_migraciones import ArnesMigracion

REVISION_ANTERIOR = "y1653reautenticacion"
REVISION = "z1749miembrodesde"

SQL_COLUMNA = (
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns "
    "WHERE table_name = 'persona' AND column_name = 'miembro_desde'"
)


def _sembrar(arnes: ArnesMigracion) -> None:
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )


def test_la_revision_es_la_unica_cabeza():
    config = AlembicConfig("alembic.ini")
    assert ScriptDirectory.from_config(config).get_heads() == [REVISION]


def test_columna_nullable_sin_default_y_sin_backfill(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_COLUMNA) == []
    _sembrar(arnes_migracion)

    arnes_migracion.migrar(REVISION)

    assert arnes_migracion.consultar(SQL_COLUMNA) == [("miembro_desde", "date", "YES", None)]
    assert arnes_migracion.consultar("SELECT id, nombres, miembro_desde FROM persona") == [(1, "Ana", None)]


def test_downgrade_y_upgrade_hacen_ida_y_vuelta(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar(arnes_migracion)
    arnes_migracion.migrar(REVISION)

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_COLUMNA) == []
    arnes_migracion.migrar(REVISION)

    assert arnes_migracion.consultar("SELECT id, miembro_desde FROM persona") == [(1, None)]
