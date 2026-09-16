"""agregar RESUMEN_CUPO_CORREO_ADMIN al enum tiponotificacion

Revision ID: o1145cupomail
Revises: n1144correolim
Create Date: 2026-09-16 18:40:00.000000

Añade el label ``RESUMEN_CUPO_CORREO_ADMIN`` al enum PostgreSQL
``tiponotificacion`` (PR D de la deuda de experiencia del alumno): es el aviso
OPERATIVO que reciben los administradores cuando el guardarraíl diario de
correos (plan gratuito de Resend, ver ``n1144correolim``) se agota y hay
envíos omitidos. No reusa ``RESUMEN_MORA_ADMIN`` a propósito: la dedup del
resumen por administrador y día se apoya en el tipo, y compartirlo haría que
el resumen de mora y el de cupo se pisaran la fila del día.

Notas técnicas (PostgreSQL), mismo patrón que ``798bfa9ae35e``
(``COBERTURA_BONIFICADA_OTORGADA``) y ``b3d7e5f1a9c2`` (``NUEVA_INSCRIPCION``):
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
revision: str = 'o1145cupomail'
down_revision: Union[str, Sequence[str], None] = 'n1144correolim'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Añadir RESUMEN_CUPO_CORREO_ADMIN al enum tiponotificacion."""
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE tiponotificacion "
            "ADD VALUE IF NOT EXISTS 'RESUMEN_CUPO_CORREO_ADMIN'"
        )


def downgrade() -> None:
    """No-op deliberado: ver el docstring del módulo."""
    pass
