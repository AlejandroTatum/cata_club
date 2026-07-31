"""catalogo de descuentos y aplicacion

Revision ID: b8d4a7e1f3c2
Revises: c3d9f2b7a1e5
Create Date: 2026-07-31 00:00:00.000000

Modelo de descuentos firmado (docs/concepto-alcance-modelo.md §4, issue #11):

  - `descuento`: catálogo VIVO administrado por el club. Porcentaje O monto
    fijo (XOR, respaldado por CHECK), nombre único, baja suave vía `activo`.
  - `descuento_aplicado`: hecho HISTÓRICO por pago. Congela el valor vigente
    al momento de aplicar (`valor_aplicado`, y `porcentaje_aplicado` si el
    descuento era porcentual), a quién se aplicó y qué administrador lo
    autorizó. Cambios posteriores al catálogo no alteran estas filas.

Los CHECK son la red de seguridad de los invariantes del catálogo (mismo
criterio que `c3d9f2b7a1e5`): el DTO/servicio sigue siendo el camino
primario de error, la base rechaza cualquier escritura que lo burle.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8d4a7e1f3c2'
down_revision: Union[str, Sequence[str], None] = 'c3d9f2b7a1e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'descuento',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nombre', sa.String(length=100), nullable=False),
        sa.Column('porcentaje', sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column('monto', sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column('activo', sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            '(porcentaje IS NULL) <> (monto IS NULL)',
            name='ck_descuento_porcentaje_o_monto',
        ),
        sa.CheckConstraint(
            'porcentaje IS NULL OR (porcentaje > 0 AND porcentaje <= 100)',
            name='ck_descuento_porcentaje_en_rango',
        ),
        sa.CheckConstraint(
            'monto IS NULL OR monto > 0',
            name='ck_descuento_monto_positivo',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('nombre'),
    )
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


def downgrade() -> None:
    """Downgrade schema. Elimina ambas tablas (hijos primero por la FK).

    Honesto sobre lo que implica: las aplicaciones históricas de descuentos
    se pierden con la tabla -- es la reversión completa de una funcionalidad
    nueva, no hay datos preexistentes que restaurar. Los pagos NO se tocan:
    su `monto` ya quedó descontado al registrarse y sigue siendo el hecho
    contable correcto aun sin el detalle de qué descuento lo produjo.
    """
    op.drop_table('descuento_aplicado')
    op.drop_table('descuento')
