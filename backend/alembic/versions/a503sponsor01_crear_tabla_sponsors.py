"""crear tabla sponsors

Revision ID: a503sponsor01
Revises: f8320ce90f10
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa

revision = "a503sponsor01"
down_revision = "f8320ce90f10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sponsor",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nombre", sa.String(length=80), nullable=False),
        sa.Column("logo_url", sa.String(length=500), nullable=False),
        sa.Column("logo_public_id", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("logo_public_id"),
    )


def downgrade() -> None:
    op.drop_table("sponsor")
