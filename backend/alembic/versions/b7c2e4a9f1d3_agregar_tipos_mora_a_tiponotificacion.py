"""agregar tipos de mora al enum tiponotificacion

Revision ID: b7c2e4a9f1d3
Revises: a9b8c7d6e5f4
Create Date: 2026-08-15 00:00:00.000000

Issue #285 (aviso de mora): una familia recibe exactamente DOS avisos tras el
vencimiento de una membresía sin un pago aprobado (día 1 y día 8 desde el
vencimiento) y un resumen diario al administrador. Se agregan tres labels al
enum PostgreSQL ``tiponotificacion``:

  * ``MIEMBRESIA_MORA_DIA_1`` — primer aviso (membresía vencida ayer).
  * ``MIEMBRESIA_MORA_DIA_8`` — segundo y último aviso.
  * ``RESUMEN_MORA_ADMIN`` — resumen diario para cada ADMINISTRADOR.

Son tres tipos separados a propósito: la clave de dedup existente
``(tipo, persona_id, entidad_relacionada_id)`` distingue así el aviso del día 1
del del día 8 sobre el mismo pago, y el resumen diario por administrador.

Notas técnicas (PostgreSQL): igual que ``a3b4c5d6e7f8``,
``ALTER TYPE ... ADD VALUE`` no puede correr dentro de un bloque transaccional
cuando el tipo ya está en uso, así que se envuelve con ``autocommit_block()``.
El ``downgrade`` es un no-op: PostgreSQL no soporta ``ALTER TYPE ... DROP
VALUE`` sin recrear el tipo y reescribir la columna, lo que destruiría
notificaciones ya emitidas.
"""

from alembic import op


revision = "b7c2e4a9f1d3"
down_revision = "a9b8c7d6e5f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE tiponotificacion ADD VALUE IF NOT EXISTS 'MIEMBRESIA_MORA_DIA_1'"
        )
        op.execute(
            "ALTER TYPE tiponotificacion ADD VALUE IF NOT EXISTS 'MIEMBRESIA_MORA_DIA_8'"
        )
        op.execute(
            "ALTER TYPE tiponotificacion ADD VALUE IF NOT EXISTS 'RESUMEN_MORA_ADMIN'"
        )


def downgrade() -> None:
    # No-op deliberado: PostgreSQL no puede quitar un label de un enum sin
    # recrear el tipo y reescribir `notificacion.tipo` (destructivo).
    pass
