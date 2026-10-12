"""«Miembro desde» de un jugador (issue #1749).

Revision ID: z1749miembrodesde
Revises: y1653sesionrotacion

Aditiva y compatible hacia atrás: una columna `persona.miembro_desde` DATE
NULLABLE, sin default y SIN backfill. Las filas existentes quedan en NULL
("sin dato"): la fecha la carga un administrador y nunca se deriva de
`fecha_registro` ni de la activación de una membresía. El día se guarda
siempre en 1 (solo importan mes y año). El código anterior ignora la columna.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "z1749miembrodesde"
down_revision: Union[str, Sequence[str], None] = "y1653sesionrotacion"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("persona", sa.Column("miembro_desde", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("persona", "miembro_desde")
