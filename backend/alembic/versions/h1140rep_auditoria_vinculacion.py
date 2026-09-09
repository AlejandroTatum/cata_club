"""Extend the representation ledger with complete audit and replay evidence."""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "h1140rep_auditoria"
down_revision: Union[str, Sequence[str], None] = "g1139repmenor"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None
TABLE = "vinculacion_representante"
TRIGGER = "trg_vinculacion_representante_append_only"
TRUNCATE_TRIGGER = "trg_vinculacion_representante_truncate"
FUNCTION = "impedir_mutacion_vinculacion_representante"
SQL_APPEND_ONLY_FUNCTION = f"""
CREATE OR REPLACE FUNCTION {FUNCTION}() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'vinculacion_representante es un ledger append-only'
        USING ERRCODE = '55000';
END;
$$;
"""
def upgrade() -> None:
    for column in (
        sa.Column("actor_persona_id", sa.Integer(), nullable=True),
        sa.Column("operacion", sa.String(length=24), nullable=True),
        sa.Column("origen", sa.String(length=32), nullable=True),
        sa.Column("idempotency_key", sa.String(length=64), nullable=True),
        sa.Column("request_fingerprint", sa.CHAR(length=64), nullable=True),
    ):
        op.add_column(TABLE, column)
    op.alter_column(TABLE, "representante_nuevo_id", nullable=True)
    op.execute(sa.text(f"""UPDATE {TABLE}
        SET actor_persona_id = representante_nuevo_id,
            operacion = 'REASIGNACION', origen = 'AUTOSERVICIO_LEGADO'
        WHERE actor_persona_id IS NULL"""))
    for column in ("actor_persona_id", "operacion", "origen"):
        op.alter_column(TABLE, column, nullable=False)

    op.create_foreign_key(
        "fk_vinculacion_representante_actor_persona", TABLE, "persona",
        ["actor_persona_id"], ["id"],
    )
    op.create_check_constraint(
        "ck_vinculacion_representante_distintos", TABLE,
        "representante_anterior_id IS NULL OR representante_nuevo_id IS NULL "
        "OR representante_anterior_id <> representante_nuevo_id",
    )
    op.create_check_constraint(
        "ck_vinculacion_representante_operacion_valores", TABLE,
        "((operacion = 'CREACION' AND representante_anterior_id IS NULL "
        "AND representante_nuevo_id IS NOT NULL) OR "
        "(operacion = 'REASIGNACION' AND representante_nuevo_id IS NOT NULL) OR "
        "(operacion = 'INDEPENDENCIA' AND representante_anterior_id IS NOT NULL "
        "AND representante_nuevo_id IS NULL))",
    )
    op.create_check_constraint(
        "ck_vinculacion_representante_origen", TABLE,
        "origen IN ('SESION_AUTENTICADA', 'ADMIN_PRESENCIAL', "
        "'AUTOSERVICIO_LEGADO', 'REMEDIACION_LEGACY')",
    )
    op.create_check_constraint(
        "ck_vinculacion_representante_fingerprint_pareado", TABLE,
        "(idempotency_key IS NULL) = (request_fingerprint IS NULL)",
    )
    op.create_check_constraint(
        "ck_vinculacion_representante_fingerprint_sha256", TABLE,
        "request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'",
    )
    op.create_index(
        "ix_vinculacion_representante_persona_fecha_id", TABLE,
        ["persona_id", sa.text("fecha DESC"), sa.text("id DESC")],
    )
    op.create_index("ix_vinculacion_representante_actor_persona_id", TABLE, ["actor_persona_id"])
    op.create_index(
        "uq_vinculacion_representante_idempotency_key", TABLE, ["idempotency_key"],
        unique=True, postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )
    op.execute(sa.text(SQL_APPEND_ONLY_FUNCTION))
    op.execute(sa.text(
        f"CREATE TRIGGER {TRIGGER} BEFORE UPDATE OR DELETE ON {TABLE} "
        f"FOR EACH ROW EXECUTE FUNCTION {FUNCTION}()"
    ))
    # `TRUNCATE` no dispara triggers por fila: sin este trigger de sentencia,
    # un solo comando vaciaría el ledger append-only.
    op.execute(sa.text(
        f"CREATE TRIGGER {TRUNCATE_TRIGGER} BEFORE TRUNCATE ON {TABLE} "
        f"FOR EACH STATEMENT EXECUTE FUNCTION {FUNCTION}()"
    ))


def downgrade() -> None:
    op.execute(sa.text(f"DROP TRIGGER IF EXISTS {TRIGGER} ON {TABLE}"))
    op.execute(sa.text(f"DROP TRIGGER IF EXISTS {TRUNCATE_TRIGGER} ON {TABLE}"))
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {FUNCTION}()"))
    op.drop_index("uq_vinculacion_representante_idempotency_key", table_name=TABLE)
    op.drop_index("ix_vinculacion_representante_actor_persona_id", table_name=TABLE)
    op.drop_index("ix_vinculacion_representante_persona_fecha_id", table_name=TABLE)
    for name in (
        "ck_vinculacion_representante_fingerprint_sha256",
        "ck_vinculacion_representante_fingerprint_pareado",
        "ck_vinculacion_representante_origen",
        "ck_vinculacion_representante_operacion_valores",
        "ck_vinculacion_representante_distintos",
    ):
        op.drop_constraint(name, TABLE, type_="check")
    op.drop_constraint("fk_vinculacion_representante_actor_persona", TABLE, type_="foreignkey")
    op.alter_column(TABLE, "representante_nuevo_id", nullable=False)
    for column in ("request_fingerprint", "idempotency_key", "origen", "operacion", "actor_persona_id"):
        op.drop_column(TABLE, column)
