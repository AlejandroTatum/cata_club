"""agregar nueva_inscripcion al enum tiponotificacion

Revision ID: b3d7e5f1a9c2
Revises: a7c1e9d4f6b2
Create Date: 2026-07-27 08:00:00.000000

Añade el label ``NUEVA_INSCRIPCION`` al enum PostgreSQL ``tiponotificacion``.

Defecto que cierra:
    ``TipoNotificacion.NUEVA_INSCRIPCION`` existe en ``app/dominio/enums.py``
    desde que se construyó la autoinscripción pública, pero ninguna migración
    lo agregó al tipo de PostgreSQL. ``EnrollmentServicio.enroll()`` llama a
    ``_notificar_nueva_inscripcion()`` en sus tres caminos, justo antes de
    emitir los tokens, de modo que toda la transacción de inscripción moría
    con ``DataError: invalid input value for enum tiponotificacion:
    "NUEVA_INSCRIPCION"`` (HTTP 500) apenas existiera un ADMINISTRADOR a quien
    notificar -- es decir, siempre en producción y nunca en los tests.

Notas técnicas (PostgreSQL):
  * ``ALTER TYPE ... ADD VALUE`` no puede ejecutarse dentro de un bloque
    transaccional cuando el tipo ya está en uso; se envuelve con
    ``op.get_context().autocommit_block()`` para que Alembic emita el
    ``COMMIT`` previo y ejecute fuera de transacción. Es el mismo patrón de
    ``f1e2d3c4b5a6`` (``REPRESENTANTE`` en ``tiporol``), y funciona porque
    ``alembic/env.py`` entrega una conexión sin transacción abierta.
  * ``IF NOT EXISTS`` mantiene la migración idempotente: no falla sobre una
    base donde el label ya fue agregado a mano.
  * El ``downgrade`` es intencionalmente un no-op. PostgreSQL no soporta
    ``ALTER TYPE ... DROP VALUE``; quitarlo exigiría recrear el tipo y
    reescribir la columna ``notificacion.tipo``, operación destructiva que
    borraría notificaciones reales de inscripción. Es la misma decisión ya
    tomada en ``e5f6a7b8c9d0`` para ``PAGO_APROBADO``/``PAGO_RECHAZADO``.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b3d7e5f1a9c2'
down_revision: Union[str, Sequence[str], None] = 'a7c1e9d4f6b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Añadir NUEVA_INSCRIPCION al enum tiponotificacion de PostgreSQL."""
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE tiponotificacion "
            "ADD VALUE IF NOT EXISTS 'NUEVA_INSCRIPCION'"
        )


def downgrade() -> None:
    """No-op deliberado: PostgreSQL no puede quitar un label de un enum sin
    recrear el tipo y reescribir ``notificacion.tipo``, lo que destruiría las
    notificaciones de inscripción ya emitidas. Ver el docstring del módulo."""
    pass
