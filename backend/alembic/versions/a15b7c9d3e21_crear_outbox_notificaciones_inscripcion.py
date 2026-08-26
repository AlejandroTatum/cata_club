"""outbox durable para notificaciones de inscripción"""

from alembic import op
import sqlalchemy as sa

revision = "a15b7c9d3e21"
down_revision = "9f4e2a7b1c6d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "enrollment_notificacion_outbox",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("admin_persona_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("alumno_persona_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("mensaje", sa.String(500), nullable=False),
        sa.Column("status", sa.String(12), nullable=False, server_default="PENDIENTE"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_redacted", sa.String(500)),
        sa.UniqueConstraint("admin_persona_id", "alumno_persona_id", name="uq_enrollment_notif_outbox_admin_alumno"),
    )
    op.create_index("ix_enrollment_notif_outbox_pending_next", "enrollment_notificacion_outbox", ["status", "next_attempt_at"])
    op.create_index("ix_enrollment_notif_outbox_admin", "enrollment_notificacion_outbox", ["admin_persona_id"])
    op.create_index("ix_enrollment_notif_outbox_alumno", "enrollment_notificacion_outbox", ["alumno_persona_id"])
    op.add_column("notificacion", sa.Column("enrollment_outbox_id", sa.Integer(), nullable=True))
    op.create_index(
        "uq_notificacion_enrollment_outbox_id",
        "notificacion",
        ["enrollment_outbox_id"],
        unique=True,
        postgresql_where=sa.text("enrollment_outbox_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_notificacion_enrollment_outbox_id", table_name="notificacion")
    op.drop_column("notificacion", "enrollment_outbox_id")
    op.drop_index("ix_enrollment_notif_outbox_alumno", table_name="enrollment_notificacion_outbox")
    op.drop_index("ix_enrollment_notif_outbox_admin", table_name="enrollment_notificacion_outbox")
    op.drop_index("ix_enrollment_notif_outbox_pending_next", table_name="enrollment_notificacion_outbox")
    op.drop_table("enrollment_notificacion_outbox")
