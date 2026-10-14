"""Origen del registro de un pago: `pago.autodeclarado` (#1768, S10).

Revision ID: z1768pagoautodeclarado
Revises: z1749miembrodesde

Aditiva y compatible hacia atrás: una columna BOOLEAN NULLABLE, sin default y
SIN backfill. Las filas existentes quedan en NULL ("origen desconocido"): un
pago anterior a la columna nunca se anula solo cuando el socio sube una
transferencia. El código anterior ignora la columna.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "z1768pagoautodeclarado"
down_revision: Union[str, Sequence[str], None] = "z1749miembrodesde"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("pago", sa.Column("autodeclarado", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("pago", "autodeclarado")
