"""remover ranking y nivel_ranking

Revision ID: 7e8032f48249
Revises: d1a5f8c30b72
Create Date: 2026-08-07 18:15:04.102391

El ranking competitivo fue derogado por decisión de producto y ya venía
siendo vaciado migración a migración (`e1b7c40d2f95`, `d4e5f6a7b8c9`,
`c9e4b1d78f30`): resultados mensuales, justificativos, reingreso, selección
oficial y el campo `esta_en_ranking` ya no existían. Lo único que quedaba de
`ranking`/`nivel_ranking` era la asignación de un alumno a un nivel/grupo de
entrenamiento -- y esa funcionalidad completa (pantallas `/nivel` y
`/trainer/nivel`, `PATCH /personas/{id}/nivel`, `GET /ranking/*` salvo
`/ranking/notificaciones/*`) fue eliminada del producto en esta misma
limpieza. Sin ningún lector ni escritor que quede, las dos tablas no tienen
ninguna razón de negocio para seguir existiendo.

`ranking` se elimina antes que `nivel_ranking` porque `fk_ranking_nivel_ranking`
depende de esta última.

Downgrade: recrea ambas tablas con exactamente las columnas, FKs e índices
que tenían en el esquema vigente (ver `c8722261ea5b`, `a1f3c9d02b7e` y
`faaadef2afa8`). Los DATOS de una funcionalidad borrada no se recuperan --
downgrade solo reconstruye la ESTRUCTURA, con las tablas vacías.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7e8032f48249'
down_revision: Union[str, Sequence[str], None] = 'd1a5f8c30b72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Los índices/FKs de `ranking` (incluida `ix_ranking_nivel_ranking_id`,
    # creada en `faaadef2afa8`) se van con la tabla -- no hace falta
    # dropearlos a mano.
    op.drop_table('ranking')
    op.drop_table('nivel_ranking')


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        'nivel_ranking',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('numero_nivel', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=80), nullable=True),
        sa.Column('capacidad_minima', sa.Integer(), nullable=False, server_default='6'),
        sa.Column('capacidad_maxima', sa.Integer(), nullable=False, server_default='10'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('numero_nivel'),
    )
    op.create_table(
        'ranking',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('persona_id', sa.Integer(), nullable=False),
        sa.Column('nivel_ranking_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['persona_id'], ['persona.id']),
        sa.ForeignKeyConstraint(
            ['nivel_ranking_id'], ['nivel_ranking.id'],
            name='fk_ranking_nivel_ranking',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('persona_id'),
    )
    op.create_index(
        'ix_ranking_nivel_ranking_id', 'ranking', ['nivel_ranking_id'],
    )
