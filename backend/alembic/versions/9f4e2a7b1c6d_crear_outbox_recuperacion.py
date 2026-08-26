"""crear outbox durable para recuperación"""

from alembic import op
import sqlalchemy as sa


revision = "9f4e2a7b1c6d"
down_revision = "f3af0e311b6a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recuperacion_outbox",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("usuario.id"), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_redacted", sa.String(500)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_recuperacion_outbox_pending_next",
        "recuperacion_outbox",
        ["status", "next_attempt_at"],
    )
    op.create_index("ix_recuperacion_outbox_usuario_id", "recuperacion_outbox", ["usuario_id"])
    op.create_index(
        "uq_recuperacion_outbox_usuario_activo",
        "recuperacion_outbox",
        ["usuario_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('PENDIENTE', 'ENVIANDO')"),
    )


def downgrade() -> None:
    op.drop_index("uq_recuperacion_outbox_usuario_activo", table_name="recuperacion_outbox")
    op.drop_index("ix_recuperacion_outbox_usuario_id", table_name="recuperacion_outbox")
    op.drop_index("ix_recuperacion_outbox_pending_next", table_name="recuperacion_outbox")
    op.drop_table("recuperacion_outbox")
