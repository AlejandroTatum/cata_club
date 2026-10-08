"""Cola de salida genérica de correos ya armados (issue #1710).

Revision ID: x1710correooutbox
Revises: x1666coguardian

Aditiva: una tabla nueva, `correo_outbox`, sin backfill. Los correos de pago y
el aviso de segundo representante dejan de salir por SMTP dentro de la
petición y se encolan acá, para que un tope diario agotado los difiera en vez
de perderlos.

`usuario_id` es nullable y `ON DELETE CASCADE`: borrar una cuenta se lleva sus
correos pendientes, que llevan su dirección y su nombre.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "x1710correooutbox"
down_revision: Union[str, Sequence[str], None] = "x1666coguardian"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLA = "correo_outbox"

INDICES = (
    ("ix_correo_outbox_pending_next", ["status", "next_attempt_at"]),
    ("ix_correo_outbox_usuario_id", ["usuario_id"]),
)


def _momento(nombre: str, obligatorio: bool) -> sa.Column:
    return sa.Column(nombre, sa.DateTime(timezone=True), nullable=not obligatorio)


def upgrade() -> None:
    op.create_table(
        TABLA,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "usuario_id", sa.Integer(),
            sa.ForeignKey("usuario.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column("destinatario", sa.String(320), nullable=False),
        sa.Column("asunto", sa.String(300), nullable=False),
        sa.Column("cuerpo_texto", sa.Text(), nullable=False),
        sa.Column("cuerpo_html", sa.Text(), nullable=True),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_error_redacted", sa.String(500)),
        sa.Column("entregas_intentadas", sa.Integer(), nullable=True),
        _momento("next_attempt_at", obligatorio=True),
        _momento("created_at", obligatorio=True),
        _momento("expires_at", obligatorio=True),
        _momento("claimed_at", obligatorio=False),
        _momento("sent_at", obligatorio=False),
        _momento("entrega_iniciada_at", obligatorio=False),
        _momento("entrega_resuelta_at", obligatorio=False),
    )
    for nombre, columnas in INDICES:
        op.create_index(nombre, TABLA, columnas)


def downgrade() -> None:
    for nombre, _columnas in INDICES:
        op.drop_index(nombre, table_name=TABLA)
    op.drop_table(TABLA)
