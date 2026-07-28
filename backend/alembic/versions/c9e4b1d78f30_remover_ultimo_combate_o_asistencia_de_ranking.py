"""remover ultimo_combate_o_asistencia de ranking

Revision ID: c9e4b1d78f30
Revises: b3d7e5f1a9c2
Create Date: 2026-07-27 00:00:00.000000

ELIMINA (DROP COLUMN) la columna `ranking.ultimo_combate_o_asistencia`.

Por qué es segura: la columna está muerta. La creó el esquema inicial
(`c8722261ea5b`, línea 134) para la limpieza automática del ranking por
inactividad, y su único escritor era el cierre mensual RF007. Ambos
mecanismos fueron removidos por decisión de producto (ver
`d4e5f6a7b8c9`, el comentario de cabecera de
`app/servicios_negocio/ranking_servicio.py` y el bloque de
`app/dominio/modelos.py` sobre `Ranking`): hoy NADIE la lee ni la escribe,
y el modelo ORM no la declara. Era el último resto del drift conocido
entre `Base.metadata` y el esquema aplicado por Alembic, filtrado a mano
en `tests/test_drift_migraciones.py`.

DESTRUCTIVO E IRREVERSIBLE EN CUANTO A DATOS: el `downgrade()` vuelve a
crear la columna con su definición original (`timestamp without time
zone`, NULL permitido — nunca entró en la conversión a `timestamptz` de
`a7c1e9d4f6b2` justamente por estar muerta), pero NO restaura ningún
valor: todas las filas quedan en NULL. Si algún día hiciera falta el dato
histórico, hay que respaldarlo ANTES de aplicar esta migración.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c9e4b1d78f30'
down_revision: Union[str, Sequence[str], None] = 'b3d7e5f1a9c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column('ranking', 'ultimo_combate_o_asistencia')


def downgrade() -> None:
    """Downgrade schema."""
    # Definición original de `c8722261ea5b`: DateTime naive y nullable. Se
    # recupera la COLUMNA, no los datos (ver docstring).
    op.add_column(
        'ranking',
        sa.Column('ultimo_combate_o_asistencia', sa.DateTime(), nullable=True),
    )
