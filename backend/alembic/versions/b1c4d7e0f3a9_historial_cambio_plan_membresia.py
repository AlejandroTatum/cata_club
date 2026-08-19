"""cambio de plan de membresía: tabla de auditoría

Revision ID: b1c4d7e0f3a9
Revises: 8a92e4d44591
Create Date: 2026-08-18 00:30:00.000000

Issue #400 (criterio 1): "Cambio de plan de una membresía existente". El
club necesita poder mover una `Membresia` YA existente a otro
`TipoMembresia` sin dar de baja la membresía vieja y crear una nueva --
`crear_membresia` bloquea una segunda membresía activa/suspendida por
persona, así que esa vía no existe. La operación es PROSPECTIVA (mismo
criterio que #394/2a para el catálogo): la cobertura ya pagada (fechas de
`Pago`/`CoberturaBonificada` ya aprobados) no se toca; la tarifa nueva rige
recién desde el próximo pago.

`historial_cambio_plan_membresia` es una tabla nueva, sin enum propio --
mismo patrón simple que `8a92e4d44591` (dos FKs a `tipo_membresia`, un CHECK
que exige que difieran, igual criterio que `ck_historial_estado_cambia` y
`ck_correccion_pago_algun_campo_cambia`).

El downgrade borra la tabla; no hay tipo Postgres que limpiar.
"""

from alembic import op
import sqlalchemy as sa


revision = "b1c4d7e0f3a9"
down_revision = "8a92e4d44591"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "historial_cambio_plan_membresia",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("membresia_id", sa.Integer(), nullable=False),
        sa.Column("tipo_membresia_id_anterior", sa.Integer(), nullable=False),
        sa.Column("tipo_membresia_id_nuevo", sa.Integer(), nullable=False),
        sa.Column("actor_persona_id", sa.Integer(), nullable=False),
        sa.Column("fecha_registro", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["membresia_id"], ["membresia.id"]),
        sa.ForeignKeyConstraint(["tipo_membresia_id_anterior"], ["tipo_membresia.id"]),
        sa.ForeignKeyConstraint(["tipo_membresia_id_nuevo"], ["tipo_membresia.id"]),
        sa.ForeignKeyConstraint(["actor_persona_id"], ["persona.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "tipo_membresia_id_anterior <> tipo_membresia_id_nuevo",
            name="ck_historial_cambio_plan_cambia",
        ),
    )
    op.create_index(
        "ix_historial_cambio_plan_membresia_membresia_id",
        "historial_cambio_plan_membresia",
        ["membresia_id"],
    )
    op.create_index(
        "ix_historial_cambio_plan_membresia_actor_persona_id",
        "historial_cambio_plan_membresia",
        ["actor_persona_id"],
    )
    # `test_indices_fk.py` exige cobertura de índice en TODA FK -- incluye
    # las dos que apuntan a `tipo_membresia`.
    op.create_index(
        "ix_historial_cambio_plan_membresia_tipo_membresia_id_anterior",
        "historial_cambio_plan_membresia",
        ["tipo_membresia_id_anterior"],
    )
    op.create_index(
        "ix_historial_cambio_plan_membresia_tipo_membresia_id_nuevo",
        "historial_cambio_plan_membresia",
        ["tipo_membresia_id_nuevo"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_historial_cambio_plan_membresia_tipo_membresia_id_nuevo",
        table_name="historial_cambio_plan_membresia",
    )
    op.drop_index(
        "ix_historial_cambio_plan_membresia_tipo_membresia_id_anterior",
        table_name="historial_cambio_plan_membresia",
    )
    op.drop_index(
        "ix_historial_cambio_plan_membresia_actor_persona_id",
        table_name="historial_cambio_plan_membresia",
    )
    op.drop_index(
        "ix_historial_cambio_plan_membresia_membresia_id",
        table_name="historial_cambio_plan_membresia",
    )
    op.drop_table("historial_cambio_plan_membresia")
