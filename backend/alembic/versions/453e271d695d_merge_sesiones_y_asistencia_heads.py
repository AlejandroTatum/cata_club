"""merge sesiones y asistencia heads

Revision ID: 453e271d695d
Revises: c4f8a2e7b013, e4a8c1b9d7f2
Create Date: 2026-08-16 09:24:28.637483

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '453e271d695d'
down_revision: Union[str, Sequence[str], None] = ('c4f8a2e7b013', 'e4a8c1b9d7f2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
