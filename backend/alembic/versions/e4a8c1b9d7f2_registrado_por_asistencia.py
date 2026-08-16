"""agregar registrado_por a asistencia (quién tomó la lista)

Revision ID: e4a8c1b9d7f2
Revises: b7c2e4a9f1d3
Create Date: 2026-08-16 00:00:00.000000

Issue #263: persistir quién tomó la lista de asistencia, matizando la decisión
de docs/product/concepto-alcance-modelo.md §«Entrenadores y horarios» (que decía
«No se registra quién dictó cada clase»). La distinción que #263 abre es entre
*quién dictó la clase* (sigue sin registrarse: sueldo mensual fijo, sin
consumidor) y *quién tomó la lista* (ahora sí: trazabilidad real de auditoría,
atada al ciclo de cobro por la corrección #262).

Columna nullable a propósito: las filas ya existentes no tienen autor conocido
y NO se backfillean con un autor falso (en la UI se muestran como
«No registrado»). FK a `persona.id` -- no a `usuario.id` como sugería el issue:
la identidad del sistema es `persona_id` en todos lados (el JWT la trae y
`Asistencia` ya usaba `persona_id` para el alumno), así que un FK a Usuario
sería la única columna del modelo que rompe esa convención.

Quién CORRIGE después es un follow-up documentado, FUERA de este alcance (no
existe columna `corregido_por`): la corrección (#262) actualiza el estado pero
no pisa `registrado_por_id`.

No requiere `autocommit_block`: es un `ADD COLUMN` nullable + FK + índice,
sin `ALTER TYPE ... ADD VALUE` (mismo patrón que `a9b8c7d6e5f4` para las
columnas de auditoría de regularización).
"""

from alembic import op
import sqlalchemy as sa


revision = "e4a8c1b9d7f2"
down_revision = "b7c2e4a9f1d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "asistencia",
        sa.Column(
            "registrado_por_id",
            sa.Integer(),
            sa.ForeignKey("persona.id"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_asistencia_registrado_por_id",
        "asistencia",
        ["registrado_por_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_asistencia_registrado_por_id", table_name="asistencia")
    op.drop_column("asistencia", "registrado_por_id")
