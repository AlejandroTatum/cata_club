"""Tabla `solicitud_supresion_datos` (issue #1062).

Procedimiento admin-revisado de supresión de datos (decisiones D1-D9 del
dueño, 2026-09-15): una persona pasa a NO identificable mientras el
historial contable (pagos, membresías, asistencias), el registro de
consentimiento legal y la auditoría de consultas a la ficha de emergencia
sobreviven enlazados a la fila `persona` anonimizada. La tabla registra el
ciclo RECIBIDA -> APROBADA -> EJECUTADA / RECHAZADA con sus fechas y
actores; `fecha_solicitud` es el ancla del plazo de gracia de 30 días (D8).

`estado` es String + CHECK (no enum nativo): mismo criterio que las tablas
de outbox; el dominio de valores es chico y de un solo flujo. Sin
`ondelete` en las FKs a `persona`: esa fila NUNCA se borra (baja lógica).

Revision ID: m1062supresion
Revises: l1207telnull
Create Date: 2026-09-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "m1062supresion"
down_revision: Union[str, Sequence[str], None] = "l1207telnull"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Issue #1062 (D9): el contenido médico se borra COMPLETO, incluido el
    # tipo de sangre. La columna pasa a NULLABLE para que el scrub pueda
    # ponerla en NULL sin borrar la fila (el historial contable la necesita
    # presente, no ausente). No hay filas legadas que backfillear: hoy el
    # NOT NULL garantiza que todas traen valor.
    op.alter_column(
        "ficha_medica", "tipo_sangre",
        existing_type=sa.Enum(
            "A_POSITIVO", "A_NEGATIVO", "B_POSITIVO", "B_NEGATIVO",
            "AB_POSITIVO", "AB_NEGATIVO", "O_POSITIVO", "O_NEGATIVO", "DESCONOCIDO",
            name="tiposangre",
        ),
        nullable=True,
    )
    op.create_table(
        "solicitud_supresion_datos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("persona_id", sa.Integer(), nullable=False),
        sa.Column("solicitada_por_persona_id", sa.Integer(), nullable=False),
        sa.Column("aprobada_por_persona_id", sa.Integer(), nullable=True),
        sa.Column("estado", sa.String(length=12), nullable=False),
        sa.Column("fecha_solicitud", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fecha_aprobacion", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fecha_ejecucion", sa.DateTime(timezone=True), nullable=True),
        sa.Column("motivo", sa.String(length=500), nullable=False),
        sa.Column("notas", sa.String(length=1000), nullable=True),
        sa.Column("razon_rechazo", sa.String(length=500), nullable=True),
        sa.Column("detalle_ejecucion", sa.String(length=2000), nullable=True),
        sa.ForeignKeyConstraint(["persona_id"], ["persona.id"]),
        sa.ForeignKeyConstraint(["solicitada_por_persona_id"], ["persona.id"]),
        sa.ForeignKeyConstraint(["aprobada_por_persona_id"], ["persona.id"]),
        sa.CheckConstraint(
            "estado IN ('RECIBIDA', 'APROBADA', 'EJECUTADA', 'RECHAZADA')",
            name="ck_solicitud_supresion_datos_estado",
        ),
    )
    op.create_index(
        "ix_solicitud_supresion_datos_persona_id",
        "solicitud_supresion_datos",
        ["persona_id"],
    )
    op.create_index(
        "ix_solicitud_supresion_datos_solicitada_por_persona_id",
        "solicitud_supresion_datos",
        ["solicitada_por_persona_id"],
    )
    op.create_index(
        "ix_solicitud_supresion_datos_aprobada_por_persona_id",
        "solicitud_supresion_datos",
        ["aprobada_por_persona_id"],
    )
    op.create_index(
        "ix_solicitud_supresion_datos_estado_fecha",
        "solicitud_supresion_datos",
        ["estado", "fecha_solicitud"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_solicitud_supresion_datos_estado_fecha", table_name="solicitud_supresion_datos"
    )
    op.drop_index(
        "ix_solicitud_supresion_datos_aprobada_por_persona_id",
        table_name="solicitud_supresion_datos",
    )
    op.drop_index(
        "ix_solicitud_supresion_datos_solicitada_por_persona_id",
        table_name="solicitud_supresion_datos",
    )
    op.drop_index(
        "ix_solicitud_supresion_datos_persona_id", table_name="solicitud_supresion_datos"
    )
    op.drop_table("solicitud_supresion_datos")
    # Restituye el NOT NULL solo si ninguna fila quedó con NULL (p. ej. tras
    # una supresión ya ejecutada); si hay nulos, el downgrade falla de forma
    # explícita en vez de descartar datos en silencio.
    op.alter_column(
        "ficha_medica", "tipo_sangre",
        existing_type=sa.Enum(
            "A_POSITIVO", "A_NEGATIVO", "B_POSITIVO", "B_NEGATIVO",
            "AB_POSITIVO", "AB_NEGATIVO", "O_POSITIVO", "O_NEGATIVO", "DESCONOCIDO",
            name="tiposangre",
        ),
        nullable=False,
    )
