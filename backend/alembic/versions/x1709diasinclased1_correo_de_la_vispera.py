"""Correo del día sin clase la víspera (issue #1709).

Revision ID: x1709diasinclased1
Revises: x1710correooutbox

Aditiva: una tabla nueva, `dia_sin_clase_correo`, que marca a qué cuenta ya
se le encoló el correo de cada día sin clase. Sin backfill: los días ya
avisados al crearse (antes de este cambio) no tienen marca, así que su
víspera vuelve a mandarles el correo como recordatorio -- aceptado en #1709.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "x1709diasinclased1"
down_revision: Union[str, Sequence[str], None] = "x1710correooutbox"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "dia_sin_clase_correo",
        sa.Column(
            "dia_sin_clase_id", sa.Integer(),
            sa.ForeignKey("dia_sin_clase.id", ondelete="CASCADE"), primary_key=True,
        ),
        sa.Column(
            "persona_id", sa.Integer(),
            sa.ForeignKey("persona.id", ondelete="CASCADE"), primary_key=True,
        ),
        sa.Column("encolado_en", sa.DateTime(timezone=True), nullable=False),
    )
    # La PK cubre `dia_sin_clase_id`; borrar una persona necesita su propio
    # índice para el ON DELETE CASCADE.
    op.create_index("ix_dia_sin_clase_correo_persona_id", "dia_sin_clase_correo", ["persona_id"])


def downgrade() -> None:
    op.drop_index("ix_dia_sin_clase_correo_persona_id", table_name="dia_sin_clase_correo")
    op.drop_table("dia_sin_clase_correo")
