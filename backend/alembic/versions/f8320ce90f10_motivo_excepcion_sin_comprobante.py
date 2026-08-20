"""motivo de la excepción auditada al aprobar sin comprobante

Revision ID: f8320ce90f10
Revises: f4a1b6d92c7e
Create Date: 2026-08-20 01:00:00.000000

Issue #459: aprobar una TRANSFERENCIA sin voucher hoy no deja ningún rastro
de POR QUÉ el admin decidió aprobarla igual -- el checklist de aprobación es
de autoatestación pura (dos checkboxes marcables sin ninguna validación
real). Decisión de producto: se permite como EXCEPCIÓN AUDITADA (el admin
verificó la cuenta bancaria directamente), nunca como camino silencioso.

Agrega a `pago` una columna nullable:

  * `motivo_excepcion_sin_comprobante` (texto, máx. 255): por qué se aprobó
    esta transferencia sin comprobante. Reusa `validado_por_persona_id`
    (issue #458 / migración `f4a1b6d92c7e`) para la identidad de quién lo
    hizo -- este campo solo agrega el motivo.

NULLABLE a nivel de esquema a propósito, mismo criterio que
`validado_por_persona_id`: el fail-closed ("nunca aprobar sin motivo en
este caso") lo exige `PagoServicio.validar_pago`, no un NOT NULL de
columna. Un NOT NULL de esquema rompería sobre transferencias ya
aprobadas sin voucher antes de este fix, que no se reescriben
retroactivamente.
"""

from alembic import op
import sqlalchemy as sa


revision = "f8320ce90f10"
down_revision = "f4a1b6d92c7e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pago",
        sa.Column(
            "motivo_excepcion_sin_comprobante",
            sa.String(length=255),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("pago", "motivo_excepcion_sin_comprobante")
