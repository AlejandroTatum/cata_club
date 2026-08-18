"""crear tabla asignacion_descuento

Revision ID: f3a9c8e2b615
Revises: d2a7e5c91b34
Create Date: 2026-08-18 00:20:00.000000

Issue #398: el descuento personal es un beneficio que el club CONCEDE a una
persona, no una elección del pago ni del usuario. Issue #400 (ciclo de
pagos) es el motivo por el que esta tabla queda deliberadamente separada de
`Pago`: congelar el valor aplicado en cada pago es responsabilidad de
`PagoServicio`, en una migración posterior -- esta sienta la base de datos
solamente.

Qué crea
--------
`asignacion_descuento`: persona <-> descuento, con auditoría de quién
asignó y quién retiró. NO tiene una columna `activo`: "vigente" es
`retirado_en IS NULL`. Dos columnas contando el mismo hecho (un booleano y
un timestamp) es exactamente cómo un modelo llega a mentir -- se podrían
escribir combinaciones contradictorias (`activo=True` con `retirado_en`
poblado) sin que nada las detecte. Un solo campo nullable es el estado Y el
dato de auditoría a la vez; no puede desalinearse consigo mismo. Ver el
docstring de `AsignacionDescuento` en `app/dominio/modelos.py` para el
razonamiento completo.

Los dos invariantes en la base
-------------------------------
1. `uq_asignacion_descuento_activa_por_persona`: índice único PARCIAL
   (`WHERE retirado_en IS NULL`) -- mismo criterio que
   `uq_membresia_activa_por_persona` (auditoría hallazgo 7, issue #8). El
   chequeo del servicio que asigne el beneficio sigue siendo el camino
   primario de error (UX); esto es la red de seguridad ante dos
   asignaciones concurrentes que lo esquiven. Parcial a propósito: el
   historial de beneficios retirados convive sin límite, igual que las
   membresías VENCIDA/INACTIVA conviven con la ACTIVA.
2. `ck_asignacion_retiro_completo`: `(retirado_en IS NULL) =
   (retirado_por_persona_id IS NULL)` -- un retiro sin su actor, o un actor
   sin timestamp, es un hecho histórico incompleto (mismo criterio que
   `ck_pago_descuento_valor_congelado` en `Pago`).

Por qué `op.create_table` (y no SQL crudo como `a4e7c2f9b1d8` o
`d2a7e5c91b34`)
------------------------------------------------------------------------
Esta tabla no tiene NINGUNA columna que reutilice un tipo Postgres (`ENUM`)
ya existente -- todas sus columnas son `INTEGER`/`TIMESTAMPTZ` estándar. El
problema documentado en esas dos migraciones (`op.create_table` reemitiendo
`CREATE TYPE` sobre un enum que ya existe y fallando con `DuplicateObject`)
no aplica acá: no hay enum que crear ni reutilizar. `op.create_table` es
seguro y es lo que usa `test_no_hay_drift_entre_modelos_y_migraciones` para
comparar contra `Base.metadata` sin sorpresas.

El downgrade borra la tabla entera; no toca `persona` ni `descuento`.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3a9c8e2b615'
down_revision: Union[str, Sequence[str], None] = 'd2a7e5c91b34'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'asignacion_descuento',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('persona_id', sa.Integer(), nullable=False),
        sa.Column('descuento_id', sa.Integer(), nullable=False),
        sa.Column('asignado_por_persona_id', sa.Integer(), nullable=False),
        sa.Column('asignado_en', sa.DateTime(timezone=True), nullable=False),
        sa.Column('retirado_por_persona_id', sa.Integer(), nullable=True),
        sa.Column('retirado_en', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            '(retirado_en IS NULL) = (retirado_por_persona_id IS NULL)',
            name='ck_asignacion_retiro_completo',
        ),
        sa.ForeignKeyConstraint(['persona_id'], ['persona.id']),
        sa.ForeignKeyConstraint(['descuento_id'], ['descuento.id']),
        sa.ForeignKeyConstraint(['asignado_por_persona_id'], ['persona.id']),
        sa.ForeignKeyConstraint(['retirado_por_persona_id'], ['persona.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'uq_asignacion_descuento_activa_por_persona',
        'asignacion_descuento', ['persona_id'], unique=True,
        postgresql_where=sa.text('retirado_en IS NULL'),
    )
    op.create_index(
        'ix_asignacion_descuento_persona_id',
        'asignacion_descuento', ['persona_id'],
    )
    op.create_index(
        'ix_asignacion_descuento_descuento_id',
        'asignacion_descuento', ['descuento_id'],
    )
    op.create_index(
        'ix_asignacion_descuento_asignado_por_persona_id',
        'asignacion_descuento', ['asignado_por_persona_id'],
    )
    op.create_index(
        'ix_asignacion_descuento_retirado_por_persona_id',
        'asignacion_descuento', ['retirado_por_persona_id'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        'ix_asignacion_descuento_retirado_por_persona_id',
        table_name='asignacion_descuento',
    )
    op.drop_index(
        'ix_asignacion_descuento_asignado_por_persona_id',
        table_name='asignacion_descuento',
    )
    op.drop_index(
        'ix_asignacion_descuento_descuento_id',
        table_name='asignacion_descuento',
    )
    op.drop_index(
        'ix_asignacion_descuento_persona_id',
        table_name='asignacion_descuento',
    )
    op.drop_index(
        'uq_asignacion_descuento_activa_por_persona',
        table_name='asignacion_descuento',
    )
    op.drop_table('asignacion_descuento')
