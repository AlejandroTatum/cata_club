"""auditoría inmutable de consentimientos legales (issue #556)

Revision ID: c556legal01
Revises: a15b7c9d3e21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c556legal01"
down_revision: Union[str, Sequence[str], None] = "a15b7c9d3e21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "consentimiento_legal",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("documento", sa.String(length=30), nullable=False),
        sa.Column("version_documento", sa.String(length=20), nullable=False),
        sa.Column("vigente_desde", sa.Date(), server_default="2026-08-27", nullable=False),
        sa.Column("texto_aceptado", sa.String(length=10000), nullable=False),
        sa.Column("aceptado_en", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("cuenta_id", sa.Integer(), nullable=False),
        sa.Column("representado_persona_id", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "documento IN ('TERMINOS', 'PRIVACIDAD', 'DATOS_MEDICOS', 'FETM')",
            name="ck_consentimiento_legal_documento",
        ),
        sa.ForeignKeyConstraint(["cuenta_id"], ["usuario.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["representado_persona_id"], ["persona.id"], ondelete="RESTRICT"),
    )
    op.create_index(
        "uq_consentimiento_legal_cuenta_documento_version_representado",
        "consentimiento_legal",
        ["cuenta_id", "documento", "version_documento", sa.text("coalesce(representado_persona_id, 0)")],
        unique=True,
    )
    op.create_index(
        "ix_consentimiento_legal_cuenta_aceptado",
        "consentimiento_legal", ["cuenta_id", "aceptado_en"], unique=False,
    )
    op.create_index(
        "ix_consentimiento_legal_representado_persona_id",
        "consentimiento_legal", ["representado_persona_id"], unique=False,
    )
    op.create_table(
        "revocacion_consentimiento_legal",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("consentimiento_id", sa.Integer(), nullable=False, unique=True),
        sa.Column("cuenta_id", sa.Integer(), nullable=False),
        sa.Column("revocado_en", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("motivo", sa.String(length=500), nullable=False),
        sa.ForeignKeyConstraint(["consentimiento_id"], ["consentimiento_legal.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["cuenta_id"], ["usuario.id"], ondelete="RESTRICT"),
    )
    op.create_index(
        "ix_revocacion_consentimiento_legal_cuenta_id",
        "revocacion_consentimiento_legal", ["cuenta_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_revocacion_consentimiento_legal_cuenta_id", table_name="revocacion_consentimiento_legal")
    op.drop_table("revocacion_consentimiento_legal")
    op.drop_index("ix_consentimiento_legal_representado_persona_id", table_name="consentimiento_legal")
    op.drop_index("ix_consentimiento_legal_cuenta_aceptado", table_name="consentimiento_legal")
    op.drop_index("uq_consentimiento_legal_cuenta_documento_version_representado", table_name="consentimiento_legal")
    op.drop_table("consentimiento_legal")
