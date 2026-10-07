"""tipo_membresia.periodicidad (tarifas semanales y diarias).

Revision ID: y1tarifaperiodicidad
Revises: x1665diasinclase

Aditiva: las tarifas existentes quedan MENSUAL. VARCHAR + CHECK en vez de un
tipo enum de Postgres, para no depender de `ALTER TYPE ... ADD VALUE` (que no
se puede revertir dentro de una transaccion, ver docs/operations/provisioning.md).
`server_default` permanente: un INSERT que no mencione la columna no debe fallar.
"""
from alembic import op
import sqlalchemy as sa

revision = "y1tarifaperiodicidad"
down_revision = "x1665diasinclase"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tipo_membresia",
        sa.Column(
            "periodicidad", sa.String(length=10),
            server_default="MENSUAL", nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_tipo_membresia_periodicidad", "tipo_membresia",
        "periodicidad IN ('MENSUAL', 'SEMANAL', 'DIARIA')",
    )


def downgrade():
    op.drop_constraint("ck_tipo_membresia_periodicidad", "tipo_membresia", type_="check")
    op.drop_column("tipo_membresia", "periodicidad")
