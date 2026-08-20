"""columna de autoría de aprobación/rechazo de pago

Revision ID: f4a1b6d92c7e
Revises: b1c4d7e0f3a9
Create Date: 2026-08-20 00:00:00.000000

Issue #458: `PATCH /pagos/{id}/validar` aprobaba o rechazaba un pago sin
registrar QUIÉN lo hizo -- a diferencia de `descuento_autorizado_por_persona_id`
(issue #11/#400) y `regularizada_por_persona_id` (issue #284), que sí nombran
a su admin.

Agrega a `pago` una columna nullable:

  * `validado_por_persona_id` (FK persona): el administrador que aprobó o
    rechazó el pago. Un solo campo sirve para las dos operaciones -- mismo
    criterio que `fecha_validacion`, que ya es el "cuándo" de ambas.

NULLABLE a nivel de esquema a propósito: el fail-closed ("nunca guardar sin
autor") lo exige `PagoServicio.validar_pago`, no un NOT NULL de columna. Un
NOT NULL de esquema rompería sobre pagos ya validados antes de este fix
(regularizados o históricos), que no se reescriben retroactivamente.
"""

from alembic import op
import sqlalchemy as sa


revision = "f4a1b6d92c7e"
down_revision = "b1c4d7e0f3a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pago",
        sa.Column(
            "validado_por_persona_id",
            sa.Integer(),
            sa.ForeignKey("persona.id"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_pago_validado_por_persona_id",
        "pago",
        ["validado_por_persona_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_pago_validado_por_persona_id", table_name="pago")
    op.drop_column("pago", "validado_por_persona_id")
