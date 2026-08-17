"""crear tabla consulta_ficha_emergencia

Revision ID: de1413036789
Revises: 453e271d695d
Create Date: 2026-08-17 00:00:00.000000

Registro observacional de consultas a la ficha de emergencia (issue #360),
mismo patrón que `sesion` (#303, revisión `c4f8a2e7b013`): guarda quién
consultó la ficha de emergencia de quién y cuándo, y nunca decide acceso. El
control de acceso lo resuelve `GestorPermisos(["ADMINISTRADOR",
"ENTRENADOR"])` en el router -- esta tabla es la protección POSTERIOR, no una
compuerta previa.

Sin `ondelete="CASCADE"` en las FKs a `persona`: a diferencia de `Usuario`
(que sí se borra duro), `Persona` se da de baja LÓGICA (`Persona.activo`,
ver el comentario en el modelo) -- nunca se borra la fila, así que la
cascada nunca dispararía y agregarla sería documentar un caso que no puede
pasar.

Downgrade: elimina el índice y la tabla, dejando el esquema idéntico al
estado previo. No hay datos que preservar -- la tabla nace vacía.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'de1413036789'
down_revision: Union[str, Sequence[str], None] = '453e271d695d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "consulta_ficha_emergencia",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("alumno_persona_id", sa.Integer(), nullable=False),
        sa.Column("consultante_persona_id", sa.Integer(), nullable=False),
        sa.Column("consultada_en", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["alumno_persona_id"], ["persona.id"]),
        sa.ForeignKeyConstraint(["consultante_persona_id"], ["persona.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    # La consulta real es siempre "quién consultó a este alumno, más
    # reciente primero" -- mismo criterio que `ix_sesion_usuario_iniciada`.
    op.create_index(
        "ix_consulta_ficha_emergencia_alumno_consultada",
        "consulta_ficha_emergencia", ["alumno_persona_id", "consultada_en"], unique=False,
    )
    # Cobertura de la segunda FK (proyecto: toda FK necesita su índice).
    op.create_index(
        "ix_consulta_ficha_emergencia_consultante_persona_id",
        "consulta_ficha_emergencia", ["consultante_persona_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_consulta_ficha_emergencia_consultante_persona_id", table_name="consulta_ficha_emergencia",
    )
    op.drop_index("ix_consulta_ficha_emergencia_alumno_consultada", table_name="consulta_ficha_emergencia")
    op.drop_table("consulta_ficha_emergencia")
