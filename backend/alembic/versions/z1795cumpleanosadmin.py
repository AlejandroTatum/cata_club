"""agregar CUMPLEANOS_HOY_ADMIN al enum tiponotificacion

Revision ID: z1795cumpleanosadmin
Revises: z1768pagoautodeclarado

Añade el label ``CUMPLEANOS_HOY_ADMIN`` al enum PostgreSQL ``tiponotificacion``:
el aviso in-app diario que reciben los administradores con los jugadores que
cumplen años hoy. Tipo propio porque la dedup por administrador y día del club
se apoya en el tipo.

Mismo patrón que ``o1145cupomail``: ``ALTER TYPE ... ADD VALUE`` no corre
dentro de un bloque transaccional cuando el tipo ya está en uso, así que va en
``autocommit_block()``; ``IF NOT EXISTS`` lo hace idempotente. El ``downgrade``
es un no-op deliberado: PostgreSQL no soporta ``DROP VALUE`` sin recrear el tipo
y reescribir ``notificacion.tipo``, operación destructiva sobre datos reales.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "z1795cumpleanosadmin"
down_revision: Union[str, Sequence[str], None] = "z1768pagoautodeclarado"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE tiponotificacion "
            "ADD VALUE IF NOT EXISTS 'CUMPLEANOS_HOY_ADMIN'"
        )


def downgrade() -> None:
    """No-op deliberado: ver el docstring del módulo."""
    pass
