"""merge remover_beca y tipos_notificacion pago heads

Revision ID: a1b2c3d4e5f6
Revises: 8dd0e8f51af9, e5f6a7b8c9d0
Create Date: 2026-07-24

Unifica las dos cabezas que se abrieron después del merge con main:
  - 8dd0e8f51af9 (remover prioridad_municipal y beca)
  - e5f6a7b8c9d0 (agregar tipos notificacion pago)

Nodo vacío: no aplica DDL, solo junta las dos ramas en una sola head
para que `alembic upgrade head` sea determinista (una única cabeza).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = ('8dd0e8f51af9', 'e5f6a7b8c9d0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
