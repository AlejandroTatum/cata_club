"""congelar descuento en columnas de pago

Revision ID: ade8e3c117ca
Revises: 7e8032f48249
Create Date: 2026-08-07 00:00:00.000000

El dueño confirmó: un pago lleva UN solo descuento. `descuento_aplicado`
(tabla 1:N desde `pago`, `b8d4a7e1f3c2`) nunca tuvo una cardinalidad real que
la justificara -- se verificó contra la base sembrada que ningún `Pago` tiene
más de un `DescuentoAplicado` antes de escribir esta migración.

Primer paso de dos (nada se borra en la misma migración que lo reemplaza):
  1. (esta) agrega las cuatro columnas congeladas a `pago` y backfillea desde
     `descuento_aplicado`, que sigue existiendo intacta.
  2. (`b8dacaddb73b`) recién ahí dropea `descuento_aplicado`.

`Descuento` (el catálogo) no se toca. Las columnas nuevas son todas
nullable: un pago puede no llevar descuento. El CHECK
`ck_pago_descuento_valor_congelado` es el espejo en la base del mismo
invariante que ya respeta `PagoServicio._congelar_descuento` (el servicio
sigue siendo el camino primario de error; la base es la red de seguridad
ante un INSERT que lo esquive).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'ade8e3c117ca'
down_revision: Union[str, Sequence[str], None] = '7e8032f48249'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('pago') as batch_op:
        batch_op.add_column(sa.Column('descuento_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('descuento_valor_aplicado', sa.Numeric(precision=10, scale=2), nullable=True))
        batch_op.add_column(sa.Column('descuento_porcentaje_aplicado', sa.Numeric(precision=5, scale=2), nullable=True))
        batch_op.add_column(sa.Column('descuento_autorizado_por_persona_id', sa.Integer(), nullable=True))
        batch_op.create_index('ix_pago_descuento_id', ['descuento_id'])
        batch_op.create_index(
            'ix_pago_descuento_autorizado_por_persona_id', ['descuento_autorizado_por_persona_id'],
        )
        batch_op.create_foreign_key(
            'fk_pago_descuento', 'descuento', ['descuento_id'], ['id'],
        )
        batch_op.create_foreign_key(
            'fk_pago_descuento_autorizado_por_persona', 'persona',
            ['descuento_autorizado_por_persona_id'], ['id'],
        )
        batch_op.create_check_constraint(
            'ck_pago_descuento_valor_congelado',
            'descuento_id IS NULL OR descuento_valor_aplicado IS NOT NULL',
        )

    # Backfill: un pago tiene a lo sumo una fila en `descuento_aplicado` (ya
    # verificado contra la base sembrada), así que copiar sin agregación es
    # correcto. Si alguna fila tuviera más de una aplicación, esta UPDATE
    # tomaría una de forma no determinística -- documentado, no silencioso:
    # es exactamente el escenario que se descartó antes de escribir esto.
    op.execute(
        """
        UPDATE pago
        SET descuento_id = da.descuento_id,
            descuento_valor_aplicado = da.valor_aplicado,
            descuento_porcentaje_aplicado = da.porcentaje_aplicado,
            descuento_autorizado_por_persona_id = da.autorizado_por_persona_id
        FROM descuento_aplicado da
        WHERE da.pago_id = pago.id
        """
    )


def downgrade() -> None:
    """Downgrade schema. `descuento_aplicado` sigue existiendo en este punto
    de la cadena (la dropea recién `b8dacaddb73b`), así que revertir esta
    migración no pierde ningún dato: la fuente de la que se backfilleó sigue
    intacta."""
    with op.batch_alter_table('pago') as batch_op:
        batch_op.drop_constraint('ck_pago_descuento_valor_congelado', type_='check')
        batch_op.drop_constraint('fk_pago_descuento_autorizado_por_persona', type_='foreignkey')
        batch_op.drop_constraint('fk_pago_descuento', type_='foreignkey')
        batch_op.drop_index('ix_pago_descuento_autorizado_por_persona_id')
        batch_op.drop_index('ix_pago_descuento_id')
        batch_op.drop_column('descuento_autorizado_por_persona_id')
        batch_op.drop_column('descuento_porcentaje_aplicado')
        batch_op.drop_column('descuento_valor_aplicado')
        batch_op.drop_column('descuento_id')
