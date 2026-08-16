"""columnas de auditoría de regularización de deuda + valor REGULARIZACION en tipopago

Revision ID: a9b8c7d6e5f4
Revises: f1a2b3c4d5e6
Create Date: 2026-08-15 00:00:00.000000

Issue #284: herramienta de administración para regularizar deuda de membresías.

El cálculo de deuda es DERIVADO (meses adeudados desde la última cobertura
aprobada hasta hoy), sin columna nueva. Pero la auditoría de la regularización
("quién/cuándo/por qué") no existe sin persistencia, así que esta migración
agrega a `pago` dos columnas nullable:

  * `regularizada_por_persona_id` (FK persona): el administrador que ejecutó la
    regularización (solo se setea en esa operación, nunca en un pago del cliente).
  * `motivo_regularizacion` (String 255): el motivo OBLIGATORIO de la
    regularización.

El "cuándo" reusa `pago.fecha_validacion`, que ya existe y se setea al crear la
regularización.

También agrega `REGULARIZACION` al enum PostgreSQL `tipopago`, el tipo de esos
pagos. Igual que `a3b4c5d6e7f8`, `ALTER TYPE ... ADD VALUE` no puede correr
dentro de un bloque transaccional cuando el tipo ya está en uso, así que se
envuelve con `op.get_context().autocommit_block()`.
"""

from alembic import op
import sqlalchemy as sa


revision = "a9b8c7d6e5f4"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pago",
        sa.Column(
            "regularizada_por_persona_id",
            sa.Integer(),
            sa.ForeignKey("persona.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "pago",
        sa.Column("motivo_regularizacion", sa.String(255), nullable=True),
    )
    op.create_index(
        "ix_pago_regularizada_por_persona_id",
        "pago",
        ["regularizada_por_persona_id"],
    )

    op.get_context().autocommit_block()
    op.execute("ALTER TYPE tipopago ADD VALUE IF NOT EXISTS 'REGULARIZACION'")


def downgrade() -> None:
    op.drop_index("ix_pago_regularizada_por_persona_id", table_name="pago")
    op.drop_column("pago", "motivo_regularizacion")
    op.drop_column("pago", "regularizada_por_persona_id")
    # PostgreSQL no permite quitar un valor de un enum; no se revierte (mismo
    # criterio que la migración de referencia d5e6f7a8b9c1).
