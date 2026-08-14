"""remover entrenador de horario y asistencia

Revision ID: e7c3a1b9d5f2
Revises: b8d4a7e1f3c2
Create Date: 2026-07-31 00:00:00.000000

Elimina `entrenador_id` de `horario_entrenamiento` y de `asistencia`
(issue #13, docs/product/concepto-alcance-modelo.md §4): el club no asigna
entrenadores a horarios -- la clase la da el entrenador disponible -- y
tampoco registra quién dictó cada sesión, porque los entrenadores cobran
un mensual fijo y el dato no tiene consumidor.

Al eliminar cada columna, Postgres elimina también su FK a `persona.id`
(sin nombre explícito en la migración inicial c8722261ea5b).

Downgrade: repone ambas columnas como NULLABLE con su FK. Los valores
originales (qué entrenador era titular de cada horario y quién dictó cada
sesión) son irrecuperables: quedan en NULL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7c3a1b9d5f2'
down_revision: Union[str, Sequence[str], None] = 'b8d4a7e1f3c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("horario_entrenamiento", "entrenador_id")
    op.drop_column("asistencia", "entrenador_id")


def downgrade() -> None:
    op.add_column(
        "horario_entrenamiento",
        sa.Column("entrenador_id", sa.Integer(), nullable=True),
    )
    # Mismo nombre autogenerado que Postgres asignó a la FK sin nombre de la
    # migración inicial (c8722261ea5b): `<tabla>_<columna>_fkey`.
    op.create_foreign_key(
        "horario_entrenamiento_entrenador_id_fkey",
        "horario_entrenamiento", "persona", ["entrenador_id"], ["id"],
    )
    op.add_column(
        "asistencia",
        sa.Column("entrenador_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "asistencia_entrenador_id_fkey",
        "asistencia", "persona", ["entrenador_id"], ["id"],
    )
