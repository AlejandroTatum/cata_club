"""Reportes de error iniciados por usuario (#1401).

Revision ID: r1401reporte
Revises: s1370pagoreg
"""
from alembic import op
import sqlalchemy as sa

revision = "r1401reporte"
down_revision = "s1370pagoreg"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE tiponotificacion ADD VALUE IF NOT EXISTS 'NUEVO_REPORTE_ERROR'")
    op.create_table(
        "reporte_error",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("persona_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("descripcion", sa.String(2000), nullable=False),
        sa.Column("request_id", sa.String(128)),
        sa.Column("ruta", sa.String(500)),
        sa.Column("user_agent", sa.String(500)),
        sa.Column("captura", sa.LargeBinary()),
        sa.Column("captura_mime", sa.String(32)),
        sa.Column("fecha_creacion", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_reporte_error_fecha_creacion", "reporte_error", ["fecha_creacion"])
    op.create_index("ix_reporte_error_persona_id", "reporte_error", ["persona_id"])


def downgrade():
    op.drop_index("ix_reporte_error_persona_id", table_name="reporte_error")
    op.drop_index("ix_reporte_error_fecha_creacion", table_name="reporte_error")
    op.drop_table("reporte_error")
