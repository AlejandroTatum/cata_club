"""categoria_horario.visible_en_landing (publicación en la landing)

La club quería decidir qué categorías de horario aparecen en el catálogo
público de la landing (`GET /asistencias/horarios-publicos`) sin tener que
borrarlas: ocultar una categoría es una decisión de PUBLICACIÓN, no de
datos -- sus horarios, inscriptos y asistencias siguen vivos y el ABM del
admin sigue viendo la fila completa.

`visible_en_landing` es ese booleano, con default TRUE a propósito: lo de
siempre no cambia. Toda categoría que existe hoy (y toda categoría que se
cree) se publica salvo que un admin la oculte explícitamente, así que la
migración es hacia atrás compatible por construcción -- ningún despliegue
deja la landing con menos categorías de las que tenía.

El patrón es el de `f2a8c31d9b64` (persona.activo): `ADD COLUMN NOT NULL`
con `server_default` (la tabla ya tiene filas en producción; sin default el
ADD falla, con default el backfill sale en la misma sentencia) y el default
del esquema se RETIRA enseguida -- el único default vivo es el del ORM
(`mapped_column(Boolean, default=True)`), igual que en `persona.activo`.
Todas las escrituras pasan por el ORM (`AsistenciaServicio` y la siembra de
`scripts/catalogo_default.py`), así que ningún camino real depende del
default del esquema.

`downgrade()` elimina la columna: destructivo en cuanto a la decisión
editorial (se pierde qué categorías estaban ocultas) pero no en cuanto a
datos de entrenamiento -- ocultar nunca tocó horarios ni asistencias.

Revision ID: qcatvis
Revises: 5b09fde49560
Create Date: 2026-09-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "qcatvis"
down_revision: Union[str, Sequence[str], None] = "5b09fde49560"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "categoria_horario",
        sa.Column("visible_en_landing", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    # Backfill hecho: se retira el default del esquema para que el único
    # default vivo sea el del ORM (ver docstring, patrón `f2a8c31d9b64`).
    op.alter_column("categoria_horario", "visible_en_landing", server_default=None)


def downgrade() -> None:
    op.drop_column("categoria_horario", "visible_en_landing")
