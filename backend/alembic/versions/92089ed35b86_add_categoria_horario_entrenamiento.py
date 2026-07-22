"""add categoria a horario_entrenamiento

Revision ID: 92089ed35b86
Revises: 84d1597c9f41
Create Date: 2026-07-22 11:20:00.000000

Gestión de Horarios (PR1): separa la categoría fija de audiencia/edad
(FORMATIVO/INFANTIL/JUVENIL/COMPETITIVO/ADULTOS) de NivelRanking, que
representa el nivel operativo del ranking mensual -- ver docstring de
`Categoria` en app/dominio/enums.py.

Estrategia de backfill (única migración, en 3 pasos):
  1. Agrega `categoria` nullable.
  2. Backfilea cada fila existente según su `hora_inicio`, comparado contra
     los 5 rangos horarios fijos de la spec de negocio.
  3. `ALTER COLUMN categoria SET NOT NULL`.

Riesgo conocido (ver design "Open Questions"): si existiera una fila con
`hora_inicio` fuera de los 5 valores conocidos (ej. sembrada manualmente
fuera del script de seed), el backfill no la alcanza y el paso 3 falla con
una violación de NOT NULL -- no hay evidencia de una base compartida/de
producción hoy, por lo que se asume que solo `seed_dev_base.py` pobló esta
tabla hasta ahora.
"""
from typing import Sequence, Union
from datetime import time

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import table, column


# revision identifiers, used by Alembic.
revision: str = '92089ed35b86'
down_revision: Union[str, Sequence[str], None] = '84d1597c9f41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CATEGORIA_ENUM_VALUES = ('FORMATIVO', 'INFANTIL', 'JUVENIL', 'COMPETITIVO', 'ADULTOS')

# Mapeo puro hora_inicio -> categoria, según los 5 rangos horarios fijos de
# la spec (FORMATIVO 15-16, INFANTIL 16-17, JUVENIL 17-18, COMPETITIVO
# 18-20, ADULTOS 20-21:15). Cubre exactamente lo que siembra
# scripts/seed_dev_base.py.
CATEGORIA_POR_HORA_INICIO = {
    time(15, 0): 'FORMATIVO',
    time(16, 0): 'INFANTIL',
    time(17, 0): 'JUVENIL',
    time(18, 0): 'COMPETITIVO',
    time(20, 0): 'ADULTOS',
}


def categoria_para_hora_inicio(hora_inicio: time) -> str:
    """Mapea una `hora_inicio` a su categoria correspondiente. Lanza
    ValueError si no coincide con ninguno de los 5 rangos conocidos -- sin
    fallback silencioso, para no asignar una categoria incorrecta."""
    try:
        return CATEGORIA_POR_HORA_INICIO[hora_inicio]
    except KeyError:
        raise ValueError(
            f"hora_inicio {hora_inicio} no coincide con ningún categoria conocido"
        )


horario_entrenamiento = table(
    'horario_entrenamiento',
    column('id', sa.Integer),
    column('hora_inicio', sa.Time),
    column('categoria', sa.String),
)


def upgrade() -> None:
    """Upgrade schema."""
    categoria_enum = sa.Enum(*CATEGORIA_ENUM_VALUES, name='categoria')
    categoria_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        'horario_entrenamiento',
        sa.Column('categoria', categoria_enum, nullable=True),
    )

    bind = op.get_bind()
    for hora_inicio, categoria in CATEGORIA_POR_HORA_INICIO.items():
        bind.execute(
            horario_entrenamiento.update()
            .where(horario_entrenamiento.c.hora_inicio == hora_inicio)
            .values(categoria=categoria)
        )

    with op.batch_alter_table('horario_entrenamiento', schema=None) as batch_op:
        batch_op.alter_column('categoria', existing_type=categoria_enum, nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('horario_entrenamiento', schema=None) as batch_op:
        batch_op.drop_column('categoria')
    sa.Enum(name='categoria').drop(op.get_bind(), checkfirst=True)
