"""corrección financiera auditable de pagos aprobados

Revision ID: 8a92e4d44591
Revises: fbd783a457d3
Create Date: 2026-08-18 00:20:00.000000

Issue #400 (slice 5b): "Corrección financiera" -- el club necesita poder
ajustar los seis campos financieros congelados de un `Pago` YA APROBADO
(`tarifa_mensual_aplicada`, `meses_comprados`, `monto_base`, `monto`,
`fecha_inicio`, `fecha_fin`) sin perder el rastro original. Texto del issue,
citado: "Toda corrección conserva: pago original; valores anteriores y
nuevos; motivo obligatorio; administrador; fecha; efecto explícito sobre
cobertura. No se permite borrar ni sobrescribir el rastro original."

`correccion_pago` es una tabla nueva, con un enum Postgres nuevo
(`efectocoberturacorreccion`) que ninguna otra columna reutiliza -- a
diferencia de `d2a7e5c91b34` (que reutilizaba `estadomembresia`, ya en uso, y
por eso necesitaba SQL crudo para esquivar el `CREATE TYPE` duplicado que
`op.create_table` intenta re-emitir), acá `op.create_table` con `sa.Enum(...)`
inline puede crear el tipo él solo sin chocar con nada preexistente. Mismo
patrón que `a1f3c9d02b7e` (`estadojustificativoranking`/`tiponotificacion`
nuevos junto a sus tablas).

El downgrade borra la tabla y, recién después, el tipo Postgres con
`sa.Enum(name=...).drop(checkfirst=True)` -- mismo orden que `a1f3c9d02b7e`
documenta: el tipo no puede borrarse mientras una columna todavía lo usa.
"""

from alembic import op
import sqlalchemy as sa


revision = "8a92e4d44591"
down_revision = "fbd783a457d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "correccion_pago",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("pago_id", sa.Integer(), nullable=False),
        sa.Column("tarifa_mensual_aplicada_anterior", sa.Numeric(10, 2), nullable=True),
        sa.Column("tarifa_mensual_aplicada_nuevo", sa.Numeric(10, 2), nullable=True),
        sa.Column("meses_comprados_anterior", sa.Integer(), nullable=True),
        sa.Column("meses_comprados_nuevo", sa.Integer(), nullable=True),
        sa.Column("monto_base_anterior", sa.Numeric(10, 2), nullable=True),
        sa.Column("monto_base_nuevo", sa.Numeric(10, 2), nullable=True),
        sa.Column("monto_anterior", sa.Numeric(10, 2), nullable=False),
        sa.Column("monto_nuevo", sa.Numeric(10, 2), nullable=False),
        sa.Column("fecha_inicio_anterior", sa.Date(), nullable=False),
        sa.Column("fecha_inicio_nuevo", sa.Date(), nullable=False),
        sa.Column("fecha_fin_anterior", sa.Date(), nullable=False),
        sa.Column("fecha_fin_nuevo", sa.Date(), nullable=False),
        sa.Column(
            "efecto_cobertura",
            sa.Enum("SIN_CAMBIO", "AMPLIADA", "REDUCIDA", name="efectocoberturacorreccion"),
            nullable=False,
        ),
        sa.Column("motivo", sa.String(length=255), nullable=False),
        sa.Column("actor_persona_id", sa.Integer(), nullable=False),
        sa.Column("fecha_registro", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["pago_id"], ["pago.id"]),
        sa.ForeignKeyConstraint(["actor_persona_id"], ["persona.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "tarifa_mensual_aplicada_anterior IS DISTINCT FROM tarifa_mensual_aplicada_nuevo"
            " OR meses_comprados_anterior IS DISTINCT FROM meses_comprados_nuevo"
            " OR monto_base_anterior IS DISTINCT FROM monto_base_nuevo"
            " OR monto_anterior IS DISTINCT FROM monto_nuevo"
            " OR fecha_inicio_anterior IS DISTINCT FROM fecha_inicio_nuevo"
            " OR fecha_fin_anterior IS DISTINCT FROM fecha_fin_nuevo",
            name="ck_correccion_pago_algun_campo_cambia",
        ),
    )
    op.create_index(
        "ix_correccion_pago_pago_id", "correccion_pago", ["pago_id"],
    )
    op.create_index(
        "ix_correccion_pago_actor_persona_id", "correccion_pago", ["actor_persona_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_correccion_pago_actor_persona_id", table_name="correccion_pago")
    op.drop_index("ix_correccion_pago_pago_id", table_name="correccion_pago")
    op.drop_table("correccion_pago")
    # Enum de Postgres: hay que borrarlo explícitamente en el downgrade
    # (a diferencia de SQLite, que no lo materializa como tipo aparte) --
    # mismo criterio que `a1f3c9d02b7e`.
    sa.Enum(name="efectocoberturacorreccion").drop(op.get_bind(), checkfirst=True)
