"""crear tabla vinculacion_representante y agregar valor a tiponotificacion

Revision ID: d5e6f7a8b9c1
Revises: c6b3e8f2a5d9
Create Date: 2026-08-11 00:00:00.000000

INS-2 (docs/decisiones-de-negocio-2026-08-11.md §1): un representante puede
vincular a su cuenta un representado ya existente escribiendo su cédula, sin
que nadie apruebe. Esta migración agrega:

  * `vinculacion_representante`: log de auditoría de cada vinculación
    (guardarraíl 1 de la decisión) -- quién vinculó a quién y cuándo.
  * `VINCULACION_REPRESENTANTE` en el enum PostgreSQL `tiponotificacion`,
    usado para avisar al representante anterior (guardarraíl 2).

Notas técnicas (PostgreSQL): igual que
`a3b4c5d6e7f8_agregar_vencimiento_a_tiponotificacion.py`, ``ALTER TYPE ...
ADD VALUE`` no puede correr dentro de un bloque transaccional cuando el tipo
ya está en uso, así que se envuelve con ``autocommit_block()``.
"""

from alembic import op
import sqlalchemy as sa

revision = "d5e6f7a8b9c1"
down_revision = "b7e4a9f2c6d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vinculacion_representante",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "persona_id", sa.Integer(),
            sa.ForeignKey("persona.id"), nullable=False,
        ),
        sa.Column(
            "representante_anterior_id", sa.Integer(),
            sa.ForeignKey("persona.id"), nullable=True,
        ),
        sa.Column(
            "representante_nuevo_id", sa.Integer(),
            sa.ForeignKey("persona.id"), nullable=False,
        ),
        sa.Column(
            "fecha", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_vinculacion_representante_persona_id",
        "vinculacion_representante",
        ["persona_id"],
    )
    op.create_index(
        "ix_vinculacion_representante_representante_anterior_id",
        "vinculacion_representante",
        ["representante_anterior_id"],
    )
    op.create_index(
        "ix_vinculacion_representante_representante_nuevo_id",
        "vinculacion_representante",
        ["representante_nuevo_id"],
    )

    op.get_context().autocommit_block()
    op.execute(
        "ALTER TYPE tiponotificacion ADD VALUE IF NOT EXISTS 'VINCULACION_REPRESENTANTE'"
    )


def downgrade() -> None:
    op.drop_index("ix_vinculacion_representante_representante_nuevo_id", table_name="vinculacion_representante")
    op.drop_index("ix_vinculacion_representante_representante_anterior_id", table_name="vinculacion_representante")
    op.drop_index("ix_vinculacion_representante_persona_id", table_name="vinculacion_representante")
    op.drop_table("vinculacion_representante")
    # PostgreSQL does not support removing a value from an enum type.
