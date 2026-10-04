"""quitar JUSTIFICADO del enum estadoasistencia (ENT-23, QA4)

Revision ID: c1asisnojust
Revises: v1retiretarifa

Decisión del dueño (QA4 ENT-23): el estado «Justificado» deja de existir. No
había marcas reales que migrar; las filas locales JUSTIFICADO pasan a AUSENTE.
ENFERMO y COMPETENCIA se conservan.

PostgreSQL no tiene ``ALTER TYPE ... DROP VALUE``, así que se recrea el tipo
(mismo patrón que ``d4e5f6a7b8c9``): primero el backfill de datos, luego
``RENAME`` del tipo viejo, ``CREATE TYPE`` sin el label, ``ALTER COLUMN ...
USING`` en las DOS columnas que lo usan (``asistencia.estado`` y
``asistencia_correccion.estado_anterior``) y ``DROP TYPE`` del viejo.
Todo corre dentro de la transacción de la migración.

El ``downgrade`` vuelve a declarar el label JUSTIFICADO (recreando el tipo con
el orden original) pero NO puede reconstruir las filas convertidas: siguen
siendo AUSENTE.
"""
from alembic import op

revision = "c1asisnojust"
down_revision = "v1retiretarifa"
branch_labels = None
depends_on = None

_COLUMNAS = (
    ("asistencia", "estado"),
    ("asistencia_correccion", "estado_anterior"),
)


def _recrear_tipo(labels: tuple[str, ...]) -> None:
    op.execute("ALTER TYPE estadoasistencia RENAME TO estadoasistencia_old")
    lista = ", ".join(f"'{label}'" for label in labels)
    op.execute(f"CREATE TYPE estadoasistencia AS ENUM ({lista})")
    for tabla, columna in _COLUMNAS:
        op.execute(
            f"ALTER TABLE {tabla} ALTER COLUMN {columna} "
            f"TYPE estadoasistencia USING {columna}::text::estadoasistencia"
        )
    op.execute("DROP TYPE estadoasistencia_old")


def upgrade() -> None:
    for tabla, columna in _COLUMNAS:
        op.execute(
            f"UPDATE {tabla} SET {columna} = 'AUSENTE' WHERE {columna} = 'JUSTIFICADO'"
        )
    _recrear_tipo(("PRESENTE", "AUSENTE", "ATRASADO", "ENFERMO", "COMPETENCIA"))


def downgrade() -> None:
    _recrear_tipo(("PRESENTE", "AUSENTE", "ATRASADO", "JUSTIFICADO", "ENFERMO", "COMPETENCIA"))
