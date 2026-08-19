"""agregar cobertura_bonificada_otorgada al enum tiponotificacion

Revision ID: 798bfa9ae35e
Revises: b4736d8ac9ee
Create Date: 2026-08-18 09:05:00.000000

Añade el label ``COBERTURA_BONIFICADA_OTORGADA`` al enum PostgreSQL
``tiponotificacion`` (issue #400, slice 4d): el aviso in-app de una cobertura
100% bonificada es deliberadamente DISTINTO de ``PAGO_APROBADO`` -- ese
mensaje dice "Su pago de $X fue aprobado", y una cobertura bonificada nunca
cobró nada. Ver ``PagoServicio.aplicar_beneficio_bonificado``.

Notas técnicas (PostgreSQL), mismo patrón que ``b3d7e5f1a9c2``
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
revision: str = '798bfa9ae35e'
down_revision: Union[str, Sequence[str], None] = 'b4736d8ac9ee'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Añadir COBERTURA_BONIFICADA_OTORGADA al enum tiponotificacion."""
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE tiponotificacion "
            "ADD VALUE IF NOT EXISTS 'COBERTURA_BONIFICADA_OTORGADA'"
        )


def downgrade() -> None:
    """No-op deliberado: ver el docstring del módulo."""
    pass
