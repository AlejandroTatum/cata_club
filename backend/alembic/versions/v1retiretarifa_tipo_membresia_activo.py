"""tipo_membresia.activo (ocultar tarifas).

Revision ID: v1retiretarifa
Revises: u2s2reviasist

Una tarifa que deja de ofrecerse se oculta en vez de borrarse: las membresias
y los pagos existentes la referencian. Las filas existentes arrancan activas.
`server_default` es permanente: un INSERT que no mencione la columna (scripts,
SQL directo) no debe fallar.
"""
from alembic import op
import sqlalchemy as sa

revision = "v1retiretarifa"
down_revision = "u2s2reviasist"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tipo_membresia",
        sa.Column("activo", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )


def downgrade():
    op.drop_column("tipo_membresia", "activo")
