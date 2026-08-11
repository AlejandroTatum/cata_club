"""categoria_horario.label es unico (ABM del admin)

Revision ID: f1a2b3c4d5e6
Revises: 8a63e448373f
Create Date: 2026-08-11 00:00:00.000000

Docs/fixes/24-abm-categorias.md: el admin ahora puede crear categorías desde
`/groups` (antes solo las sembraba una migración), así que dos filas con el
mismo `label` ("Preinfantil" dos veces, con `codigo` distinto) ya no es un
caso hipotético -- sería una tarjeta duplicada y confusa en pantalla. El
chequeo real vive en `AsistenciaServicio.crear_categoria`/
`actualizar_categoria` (mensaje legible antes del INSERT/UPDATE); este
UNIQUE es la red de seguridad ante una escritura concurrente que lo burle,
mismo patrón que `uq_horario_categoria_dia` (migración `b7e4a9f2c6d1`).

Sin dedup de datos: las 5 categorías sembradas ya tienen labels distintos
("Formativo", "Infantil", "Juvenil", "Adultos", "Competitivo"), así que no
hay violación preexistente que limpiar.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = '8a63e448373f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_categoria_horario_label", "categoria_horario", ["label"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_categoria_horario_label", "categoria_horario", type_="unique")
