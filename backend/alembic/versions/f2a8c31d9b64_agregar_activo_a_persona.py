"""agregar activo a persona (baja logica)

Revision ID: f2a8c31d9b64
Revises: c9e4b1d78f30
Create Date: 2026-07-27 00:00:00.000000

Agrega `persona.activo` para soportar la baja LÓGICA de una persona
(desactivar en vez de borrar). Reemplaza al borrado duro que exponía
`DELETE /personas/{persona_id}`, que se llevaba por delante el historial de
asistencias, los pagos y la ficha médica del ex-miembro.

Por qué NOT NULL con `server_default` temporal, y no una columna nullable:

  - `persona` es una tabla que YA TIENE FILAS en producción. Un `ADD COLUMN
    ... NOT NULL` sin default falla en el acto sobre una tabla no vacía
    ("column contains null values"), así que el `server_default` no es
    cosmético: es lo que hace que la migración corra y, de paso, lo que
    rellena las filas existentes con TRUE (todo el mundo que ya está en el
    club sigue activo).
  - Nullable habría sido peor: un `NULL` en un flag booleano de pertenencia
    es un tercer estado sin significado ("¿es miembro?" no admite "no sé"),
    y obligaría a todos los filtros de listado a escribir
    `activo IS NOT FALSE` en vez de `activo IS TRUE`.
  - El `server_default` se REMUEVE inmediatamente después del backfill: el
    modelo ORM declara `default=True` del lado de Python (idéntico a
    `Usuario.activo`), y dejar además un default en el esquema duplicaría la
    fuente de verdad. El esquema resultante es exactamente el que produce
    `Mapped[bool] = mapped_column(Boolean, default=True)`, que es lo que
    `test_drift_migraciones.py` compara contra `Base.metadata`.

El `downgrade()` elimina la columna. Es destructivo en cuanto a datos (se
pierde qué personas estaban dadas de baja) pero no en cuanto a personas: la
baja lógica nunca borró una fila, así que revertir devuelve a todo el mundo
al roster operativo, no lo destruye.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2a8c31d9b64'
down_revision: Union[str, Sequence[str], None] = 'c9e4b1d78f30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'persona',
        sa.Column('activo', sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    # Backfill hecho: se retira el default del esquema para que el único
    # default vivo sea el del ORM (ver docstring).
    op.alter_column('persona', 'activo', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('persona', 'activo')
