"""Add the payment-recorded in-app notification type (#1370).

Revision ID: s1370pagoreg
Revises: r1372galeria
"""
from alembic import op

revision = "s1370pagoreg"
down_revision = "r1372galeria"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE tiponotificacion ADD VALUE IF NOT EXISTS 'PAGO_REGISTRADO'")


def downgrade() -> None:
    # PostgreSQL cannot drop an enum value without rewriting existing rows.
    pass
