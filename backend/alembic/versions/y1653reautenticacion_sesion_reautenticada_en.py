"""Step-up de contraseña para el cambio de roles (issue #1653, S5).

Revision ID: y1653reautenticacion
Revises: y1653sesionrotacion

Aditiva y compatible hacia atrás: una columna NULLABLE en `sesion`
(`reautenticada_en`), sin backfill ni índice. Nulo significa "esta sesión no
re-ingresó la contraseña", que es el estado correcto para toda fila previa. El
código anterior ignora la columna.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "y1653reautenticacion"
down_revision: Union[str, Sequence[str], None] = "y1653sesionrotacion"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sesion", sa.Column("reautenticada_en", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("sesion", "reautenticada_en")
