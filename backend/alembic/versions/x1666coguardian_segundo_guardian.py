"""Segundo guardián de un menor (issue #1666).

Revision ID: x1666coguardian
Revises: w1galeriaorden

Aditiva: tres tablas nuevas y dos triggers. No toca `persona.representante_id`
ni `vinculacion_representante`, así que los datos de representación existentes
quedan intactos.

- `co_representante`: vínculo activo. `UNIQUE(persona_id)` es el tope de dos
  guardianes (principal + uno). Un trigger impide que el segundo guardián sea
  el mismo que el principal del menor.
- `co_representante_invitacion`: invitación que creó la cuenta del segundo
  guardián (sin token: el enlace es el de fijar contraseña de siempre). A lo
  sumo una pendiente por menor.
- `co_representante_evento`: ledger append-only de invitaciones, altas y bajas.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "x1666coguardian"
down_revision: Union[str, Sequence[str], None] = "w1galeriaorden"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

EVENTO = "co_representante_evento"
FN_APPEND_ONLY = "impedir_mutacion_co_representante_evento"
TRG_APPEND_ONLY = "trg_co_representante_evento_append_only"
TRG_TRUNCATE = "trg_co_representante_evento_truncate"
FN_DISTINTO = "co_representante_distinto_del_principal"
TRG_DISTINTO = "trg_co_representante_distinto_del_principal"


def upgrade() -> None:
    op.create_table(
        "co_representante",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("persona_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("co_representante_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("creado_en", sa.DateTime(timezone=True), nullable=False),
        sa.Column("creado_por_persona_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.UniqueConstraint("persona_id", name="uq_co_representante_persona"),
        sa.CheckConstraint(
            "persona_id <> co_representante_id", name="ck_co_representante_distintos",
        ),
    )
    op.create_index(
        "ix_co_representante_co_representante_id", "co_representante", ["co_representante_id"],
    )
    op.create_index(
        "ix_co_representante_creado_por_persona_id", "co_representante", ["creado_por_persona_id"],
    )

    op.create_table(
        "co_representante_invitacion",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("persona_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("co_representante_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("correo", sa.String(length=255), nullable=False),
        sa.Column("invitada_por_persona_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("creada_en", sa.DateTime(timezone=True), nullable=False),
        sa.Column("aceptada_en", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelada_en", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_co_representante_invitacion_persona_id", "co_representante_invitacion", ["persona_id"],
    )
    op.create_index(
        "ix_co_representante_invitacion_co_representante_id",
        "co_representante_invitacion", ["co_representante_id"],
    )
    op.create_index(
        "ix_co_representante_invitacion_invitada_por_persona_id",
        "co_representante_invitacion", ["invitada_por_persona_id"],
    )
    op.create_index(
        "uq_co_representante_invitacion_pendiente",
        "co_representante_invitacion",
        ["persona_id"],
        unique=True,
        postgresql_where=sa.text("aceptada_en IS NULL AND cancelada_en IS NULL"),
    )

    op.create_table(
        EVENTO,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("fecha", sa.DateTime(timezone=True), nullable=False),
        sa.Column("persona_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("co_representante_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=True),
        sa.Column("actor_persona_id", sa.Integer(), sa.ForeignKey("persona.id"), nullable=False),
        sa.Column("operacion", sa.String(length=24), nullable=False),
        sa.Column("origen", sa.String(length=16), nullable=False),
        sa.Column(
            "invitacion_id", sa.Integer(),
            sa.ForeignKey("co_representante_invitacion.id"), nullable=True,
        ),
        sa.CheckConstraint(
            "operacion IN ('INVITACION', 'INVITACION_CANCELADA', 'ALTA', 'ACEPTACION', 'BAJA')",
            name="ck_co_representante_evento_operacion",
        ),
        sa.CheckConstraint(
            "origen IN ('REPRESENTANTE', 'ADMIN', 'INVITADO', 'SISTEMA')",
            name="ck_co_representante_evento_origen",
        ),
    )
    op.execute(sa.text(
        "CREATE INDEX ix_co_representante_evento_persona_fecha "
        f"ON {EVENTO} (persona_id, fecha DESC, id DESC)"
    ))
    for columna in ("co_representante_id", "actor_persona_id", "invitacion_id"):
        op.create_index(f"ix_co_representante_evento_{columna}", EVENTO, [columna])

    op.execute(sa.text(f"""
        CREATE OR REPLACE FUNCTION {FN_APPEND_ONLY}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION '{EVENTO} es un ledger append-only'
                USING ERRCODE = '55000';
        END;
        $$;
    """))
    op.execute(sa.text(
        f"CREATE TRIGGER {TRG_APPEND_ONLY} BEFORE UPDATE OR DELETE ON {EVENTO} "
        f"FOR EACH ROW EXECUTE FUNCTION {FN_APPEND_ONLY}()"
    ))
    op.execute(sa.text(
        f"CREATE TRIGGER {TRG_TRUNCATE} BEFORE TRUNCATE ON {EVENTO} "
        f"FOR EACH STATEMENT EXECUTE FUNCTION {FN_APPEND_ONLY}()"
    ))

    op.execute(sa.text(f"""
        CREATE OR REPLACE FUNCTION {FN_DISTINTO}() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM persona
                WHERE id = NEW.persona_id AND representante_id = NEW.co_representante_id
            ) THEN
                RAISE EXCEPTION 'el segundo guardián no puede ser el representante principal'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$;
    """))
    op.execute(sa.text(
        f"CREATE TRIGGER {TRG_DISTINTO} BEFORE INSERT OR UPDATE ON co_representante "
        f"FOR EACH ROW EXECUTE FUNCTION {FN_DISTINTO}()"
    ))


def downgrade() -> None:
    op.execute(sa.text(f"DROP TRIGGER IF EXISTS {TRG_DISTINTO} ON co_representante"))
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {FN_DISTINTO}()"))
    op.execute(sa.text(f"DROP TRIGGER IF EXISTS {TRG_APPEND_ONLY} ON {EVENTO}"))
    op.execute(sa.text(f"DROP TRIGGER IF EXISTS {TRG_TRUNCATE} ON {EVENTO}"))
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {FN_APPEND_ONLY}()"))
    op.drop_table(EVENTO)
    op.drop_table("co_representante_invitacion")
    op.drop_table("co_representante")
