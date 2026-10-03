"""asistencia.requiere_revision (ENT-07).

Revision ID: u2s2reviasist
Revises: t1314metricas

Se permite registrar asistencia de un alumno no operativo (persona dada de baja
o con membresía suspendida) o con una fecha anterior a su inscripción, pero
esa fila queda marcada para que el admin la revise. Las filas existentes
arrancan en FALSE: nadie las marcó. `server_default` es permanente -- un
INSERT que no mencione la columna (scripts, SQL directo) no debe fallar.
"""
from alembic import op
import sqlalchemy as sa

revision = "u2s2reviasist"
down_revision = "t1314metricas"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "asistencia",
        sa.Column("requiere_revision", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )


def downgrade():
    op.drop_column("asistencia", "requiere_revision")
