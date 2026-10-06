"""Add no-class days (#1665): table and the in-app notification type.

Revision ID: x1665diasinclase
Revises: w1galeriaorden
"""
import sqlalchemy as sa
from alembic import op

revision = "x1665diasinclase"
down_revision = "w1galeriaorden"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tiponotificacion ADD VALUE IF NOT EXISTS 'DIA_SIN_CLASE'")
    op.create_table(
        "dia_sin_clase",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("fecha_inicio", sa.Date(), nullable=False),
        sa.Column("fecha_fin", sa.Date(), nullable=False),
        sa.Column("motivo", sa.String(length=200), nullable=False),
        sa.Column("fecha_creacion", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("fecha_fin >= fecha_inicio", name="ck_dia_sin_clase_rango"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dia_sin_clase_fecha_fin", "dia_sin_clase", ["fecha_fin"])


def downgrade() -> None:
    op.drop_index("ix_dia_sin_clase_fecha_fin", table_name="dia_sin_clase")
    op.drop_table("dia_sin_clase")
    # PostgreSQL cannot drop an enum value without rewriting existing rows.
