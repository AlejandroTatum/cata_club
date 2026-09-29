"""agregar cobertura_bonificada_admin al enum tiponotificacion

Revision ID: c4b3a1d9e7f2
Revises: r1372galeria
Create Date: 2026-08-19 09:00:00.000000

Añade el label ``COBERTURA_BONIFICADA_ADMIN`` al enum PostgreSQL
``tiponotificacion`` (issue #1369, slice 2): el aviso operativo a los
administradores en cada activación de cobertura bonificada es deliberadamente
DISTINTO de ``COBERTURA_BONIFICADA_OTORGADA`` -- ese es el aviso del TITULAR;
este tiene otro destinatario (cada admin con cuenta activa) y otro mensaje.
Ver ``PagoServicio._notificar_admins_cobertura``.

Notas técnicas (PostgreSQL), mismo patrón que ``798bfa9ae35e``:
  * ``ALTER TYPE ... ADD VALUE`` no puede ejecutarse dentro de un bloque
    transaccional cuando el tipo ya está en uso; se envuelve con
    ``op.get_context().autocommit_block()``.
  * ``IF NOT EXISTS`` mantiene la migración idempotente.
  * El ``downgrade`` es intencionalmente un no-op: PostgreSQL no soporta
    ``ALTER TYPE ... DROP VALUE`` sin recrear el tipo y reescribir
    ``notificacion.tipo``, operación destructiva sobre notificaciones reales.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c4b3a1d9e7f2'
down_revision: Union[str, Sequence[str], None] = 'r1372galeria'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Añadir COBERTURA_BONIFICADA_ADMIN al enum tiponotificacion."""
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE tiponotificacion "
            "ADD VALUE IF NOT EXISTS 'COBERTURA_BONIFICADA_ADMIN'"
        )


def downgrade() -> None:
    """No-op deliberado: ver el docstring del módulo."""
    pass
