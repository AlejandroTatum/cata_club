"""crear tabla inscripcion_idempotencia

Revision ID: f3af0e311b6a
Revises: a503sponsor01
"""
from alembic import op
import sqlalchemy as sa


revision = "f3af0e311b6a"
down_revision = "a503sponsor01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inscripcion_idempotencia",
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("estado", sa.String(length=20), nullable=False),
        sa.Column("persona_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("vence_en", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["persona_id"], ["persona.id"]),
        sa.PrimaryKeyConstraint("idempotency_key"),
        sa.Index("ix_inscripcion_idempotencia_persona_id", "persona_id"),
    )


def downgrade() -> None:
    op.drop_table("inscripcion_idempotencia")
