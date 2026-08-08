"""drop descuento_aplicado

Revision ID: b8dacaddb73b
Revises: ade8e3c117ca
Create Date: 2026-08-07 00:00:01.000000

Segundo paso de dos: `ade8e3c117ca` ya congeló el descuento de cada pago en
las columnas `descuento_*` de `pago` (y backfilleó desde esta tabla), así que
`descuento_aplicado` queda sin lectores. La dropea.

Downgrade: recrea la tabla vacía, con las mismas columnas, FKs e índices
exactos que tenía en `b8d4a7e1f3c2`. Los DATOS NO SE RECUPERAN -- esta
migración, igual que la que la creó, es honesta sobre esa pérdida: el hecho
histórico ya vive en `pago.descuento_*`, que esta migración no toca, así que
no hay corrupción contable, solo la ausencia de la tabla vieja hasta el
próximo upgrade.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b8dacaddb73b'
down_revision: Union[str, Sequence[str], None] = 'ade8e3c117ca'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table('descuento_aplicado')


def downgrade() -> None:
    """Downgrade schema. Recrea el esquema exacto de `b8d4a7e1f3c2` -- vacío.
    Los datos que vivían acá antes del drop NO se recuperan."""
    op.create_table(
        'descuento_aplicado',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('valor_aplicado', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('porcentaje_aplicado', sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column('fecha', sa.DateTime(timezone=True), nullable=False),
        sa.Column('pago_id', sa.Integer(), nullable=False),
        sa.Column('descuento_id', sa.Integer(), nullable=False),
        sa.Column('persona_id', sa.Integer(), nullable=False),
        sa.Column('autorizado_por_persona_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['pago_id'], ['pago.id'], ),
        sa.ForeignKeyConstraint(['descuento_id'], ['descuento.id'], ),
        sa.ForeignKeyConstraint(['persona_id'], ['persona.id'], ),
        sa.ForeignKeyConstraint(['autorizado_por_persona_id'], ['persona.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_descuento_aplicado_pago_id', 'descuento_aplicado', ['pago_id'])
    op.create_index('ix_descuento_aplicado_descuento_id', 'descuento_aplicado', ['descuento_id'])
    op.create_index('ix_descuento_aplicado_persona_id', 'descuento_aplicado', ['persona_id'])
    op.create_index(
        'ix_descuento_aplicado_autorizado_por_persona_id', 'descuento_aplicado',
        ['autorizado_por_persona_id'],
    )
