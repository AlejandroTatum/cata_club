"""Actividad diaria por usuario, ultimo_acceso e instantaneas de metricas (#1314).

Revision ID: t1314metricas
Revises: r1401reporte
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "t1314metricas"
down_revision = "r1401reporte"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("usuario", sa.Column("ultimo_acceso", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "actividad_usuario",
        sa.Column("usuario_id", sa.Integer(), sa.ForeignKey("usuario.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("fecha", sa.Date(), primary_key=True),
        sa.Column("franja", sa.SmallInteger(), primary_key=True),
    )
    op.create_index("ix_actividad_usuario_fecha_franja", "actividad_usuario", ["fecha", "franja"])

    op.create_table(
        "metrica_instantanea",
        sa.Column("capturada_en", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("intervalo_s", sa.Integer()),
        sa.Column("peticiones", sa.Integer()),
        sa.Column("errores_5xx", sa.Integer()),
        sa.Column("errores_4xx", sa.Integer()),
        sa.Column("latencia_buckets", JSONB()),
        sa.Column("rutas", JSONB()),
        sa.Column("outbox_pendientes", sa.Integer()),
        sa.Column("outbox_mas_antiguo_s", sa.Integer()),
        sa.Column("cola_celery", sa.Integer()),
        sa.Column("db_conexiones", sa.Integer()),
        sa.Column("db_conexiones_max", sa.Integer()),
        sa.Column("redis_usado_mb", sa.Float()),
        sa.Column("redis_max_mb", sa.Float()),
        sa.Column("logins_ok", sa.Integer()),
        sa.Column("logins_fallidos", sa.Integer()),
        sa.Column("conectados", sa.Integer()),
        sa.Column("conectados_por_rol", JSONB()),
        sa.Column("host_actualizado_en", sa.DateTime(timezone=True)),
        sa.Column("host_cpu_pct", sa.Float()),
        sa.Column("host_ram_usada_mb", sa.Integer()),
        sa.Column("host_ram_total_mb", sa.Integer()),
        sa.Column("host_swap_usada_mb", sa.Integer()),
        sa.Column("host_swap_total_mb", sa.Integer()),
        sa.Column("host_disco_pct", sa.Float()),
        sa.Column("host_contenedores", JSONB()),
    )


def downgrade():
    op.drop_table("metrica_instantanea")
    op.drop_index("ix_actividad_usuario_fecha_franja", table_name="actividad_usuario")
    op.drop_table("actividad_usuario")
    op.drop_column("usuario", "ultimo_acceso")
