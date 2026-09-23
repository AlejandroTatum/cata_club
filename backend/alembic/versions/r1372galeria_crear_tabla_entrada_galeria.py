"""crear tabla entrada_galeria (issue #1372)

Revision ID: r1372galeria
Revises: qcatvis
Create Date: 2026-09-15
"""
from alembic import op
import sqlalchemy as sa

revision = "r1372galeria"
down_revision = "qcatvis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "entrada_galeria",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("titulo", sa.String(length=80), nullable=False),
        sa.Column("descripcion", sa.String(length=500), nullable=False),
        sa.Column("imagen_url", sa.String(length=500), nullable=False),
        sa.Column("imagen_public_id", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("imagen_public_id"),
    )


def downgrade() -> None:
    op.drop_table("entrada_galeria")
