"""agregar RECORDATORIO_SESION al enum tiponotificacion

Revision ID: p1146recses
Revises: o1145cupomail
Create Date: 2026-09-16 21:30:00.000000

Añade el label ``RECORDATORIO_SESION`` al enum PostgreSQL
``tiponotificacion`` (PR F de la deuda de experiencia del alumno): es el
recordatorio BELL-ONLY de la sesión de mañana que crea la tarea diaria
``recordatorio_sesion_tareas.recordar_sesion_de_manana``. No reusa ningún
tipo existente a propósito: la dedup que impide duplicar el aviso cuando la
tarea se reintenta es ``(tipo, persona_id, entidad_relacionada_id)``, así que
compartir tipo con otro aviso haría que el uno pisara la fila del otro.

Notas técnicas (PostgreSQL), mismo patrón que ``o1145cupomail``
(``RESUMEN_CUPO_CORREO_ADMIN``), ``798bfa9ae35e``
(``COBERTURA_BONIFICADA_OTORGADA``) y ``b3d7e5f1a9c2``
(``NUEVA_INSCRIPCION``):
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
revision: str = 'p1146recses'
down_revision: Union[str, Sequence[str], None] = 'o1145cupomail'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Añadir RECORDATORIO_SESION al enum tiponotificacion."""
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE tiponotificacion "
            "ADD VALUE IF NOT EXISTS 'RECORDATORIO_SESION'"
        )


def downgrade() -> None:
    """No-op deliberado: ver el docstring del módulo."""
    pass
