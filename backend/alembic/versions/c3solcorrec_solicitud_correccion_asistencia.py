"""crear tabla solicitud_correccion_asistencia (ENT-25, QA4)

Revision ID: c3solcorrec
Revises: c1asisnojust

El entrenador no puede corregir una lista cerrada (solo el administrador, vía
``asistencia_correccion``), así que la tabla guarda su PEDIDO de corrección:
qué asistencia, qué estado debería figurar y por qué, más la resolución del
administrador (aprobada o rechazada con motivo).

Encadenada sobre ``c1asisnojust``, la cabeza que existe en la base de esta
rama (C1 + C16). Si otra rebanada agrega una migración sobre la misma cabeza,
hay que re-apuntar ``down_revision`` al componer (ver el log de QA4, L25).

Mismo patrón que ``300423734f25``: SQL crudo para referenciar el tipo
``estadoasistencia`` ya existente sin que ``op.create_table`` intente
recrearlo. El tipo ``estadosolicitudcorreccion`` es nuevo.

Un índice único PARCIAL deja una sola solicitud pendiente por asistencia y
cubre además la FK ``asistencia_id``. Puramente aditiva: la tabla nace vacía.
"""
from alembic import op

revision = "c3solcorrec"
down_revision = "c1asisnojust"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE estadosolicitudcorreccion AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA')"
    )
    op.execute(
        "CREATE TABLE solicitud_correccion_asistencia ("
        "id SERIAL PRIMARY KEY, "
        "asistencia_id INTEGER NOT NULL REFERENCES asistencia (id), "
        "solicitado_por_id INTEGER NOT NULL REFERENCES persona (id), "
        "solicitado_en TIMESTAMPTZ NOT NULL, "
        "estado_solicitado estadoasistencia NOT NULL, "
        "motivo VARCHAR(500) NOT NULL, "
        "estado estadosolicitudcorreccion NOT NULL, "
        "resuelto_por_id INTEGER REFERENCES persona (id), "
        "resuelto_en TIMESTAMPTZ, "
        "motivo_resolucion VARCHAR(500)"
        ")"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_solicitud_correccion_pendiente_por_asistencia "
        "ON solicitud_correccion_asistencia (asistencia_id) WHERE estado = 'PENDIENTE'"
    )
    op.create_index(
        "ix_solicitud_correccion_estado_solicitado_en",
        "solicitud_correccion_asistencia", ["estado", "solicitado_en"], unique=False,
    )
    op.create_index(
        "ix_solicitud_correccion_asistencia_id",
        "solicitud_correccion_asistencia", ["asistencia_id"], unique=False,
    )
    op.create_index(
        "ix_solicitud_correccion_solicitado_por_id",
        "solicitud_correccion_asistencia", ["solicitado_por_id"], unique=False,
    )
    op.create_index(
        "ix_solicitud_correccion_resuelto_por_id",
        "solicitud_correccion_asistencia", ["resuelto_por_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_table("solicitud_correccion_asistencia")
    op.execute("DROP TYPE estadosolicitudcorreccion")
