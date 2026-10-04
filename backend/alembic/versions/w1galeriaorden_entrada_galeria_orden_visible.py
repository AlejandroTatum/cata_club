"""entrada_galeria.orden y .visible (editar, ordenar y ocultar fotos).

Revision ID: w1galeriaorden
Revises: c3solcorrec

ADMB-34: una foto se puede ocultar sin borrarla y ordenar a mano. Las filas
existentes arrancan visibles y con `orden` igual a su id, que conserva el
orden actual (de la más antigua a la más reciente). Los `server_default` son
permanentes: un INSERT que no mencione las columnas no debe fallar.
"""
from alembic import op
import sqlalchemy as sa

revision = "w1galeriaorden"
down_revision = "c3solcorrec"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "entrada_galeria",
        sa.Column("orden", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "entrada_galeria",
        sa.Column("visible", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.execute("UPDATE entrada_galeria SET orden = id")


def downgrade():
    op.drop_column("entrada_galeria", "visible")
    op.drop_column("entrada_galeria", "orden")
