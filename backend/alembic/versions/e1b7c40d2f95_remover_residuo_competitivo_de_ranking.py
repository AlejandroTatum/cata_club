"""remover residuo competitivo de ranking

Revision ID: e1b7c40d2f95
Revises: f2a8c31d9b64
Create Date: 2026-07-27 00:00:00.000000

ELIMINA (DROP COLUMN) las cuatro columnas que quedaban del ranking
competitivo en la tabla `ranking`:

  - `puntaje_acumulado`, `posicion_actual`, `participo`: congeladas desde
    que se removió el cierre mensual RF007 (`d4e5f6a7b8c9`), que era su
    único escritor. Ningún endpoint, servicio, seed, script ni reporte las
    lee; los DTO de solo lectura ya habían dejado de exponerlas y el único
    que quedaba (`RankingResponseDTO`) se limpia en este mismo cambio.

  - `esta_en_ranking`: era el flag de "visibilidad" del ranking. Se leía en
    varios lugares, pero NADIE la ponía nunca en False: los dos mecanismos
    automáticos que lo hacían (la limpieza por inactividad de Celery Beat y
    el cierre mensual) fueron removidos, y la "baja manual/administrativa"
    que describía el comentario del modelo nunca llegó a existir como
    endpoint ni como servicio. Era, por lo tanto, permanentemente True para
    toda fila, y filtrar por ella era un no-op. El estado de asignación de
    un alumno lo lleva `nivel_ranking_id`: tener nivel ES estar asignado.

DESTRUCTIVO EN CUANTO A DATOS: el `downgrade()` recrea las cuatro columnas
con su definición original (ver el esquema inicial `c8722261ea5b`, líneas
131-135), incluidos sus defaults, pero NO restaura ningún valor histórico.
Tras un downgrade toda fila queda con `puntaje_acumulado = 0`,
`posicion_actual = NULL`, `participo = false` y `esta_en_ranking = true`,
que es exactamente el estado congelado en el que estaban antes de borrarlas
(el único escritor llevaba tiempo removido), así que en la práctica no se
pierde información viva. Si aun así se necesitara el histórico, respaldarlo
ANTES de aplicar esta migración.

Los `server_default` de la recreación son un andamio: hacen falta para poder
declarar las columnas NOT NULL sobre una tabla que ya tiene filas, y se
retiran acto seguido con `alter_column(server_default=None)` porque el
esquema inicial no los tenía (los defaults eran del lado Python, en el
modelo ORM). Así el downgrade deja la tabla exactamente como estaba.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1b7c40d2f95'
down_revision: Union[str, Sequence[str], None] = 'f2a8c31d9b64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column('ranking', 'esta_en_ranking')
    op.drop_column('ranking', 'participo')
    op.drop_column('ranking', 'posicion_actual')
    op.drop_column('ranking', 'puntaje_acumulado')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        'ranking',
        sa.Column(
            'puntaje_acumulado', sa.Integer(),
            nullable=False, server_default=sa.text('0'),
        ),
    )
    op.add_column(
        'ranking',
        sa.Column('posicion_actual', sa.Integer(), nullable=True),
    )
    op.add_column(
        'ranking',
        sa.Column(
            'participo', sa.Boolean(),
            nullable=False, server_default=sa.text('false'),
        ),
    )
    op.add_column(
        'ranking',
        sa.Column(
            'esta_en_ranking', sa.Boolean(),
            nullable=False, server_default=sa.text('true'),
        ),
    )
    # Retira el andamio: el esquema inicial no declaraba server_default.
    op.alter_column('ranking', 'puntaje_acumulado', server_default=None)
    op.alter_column('ranking', 'participo', server_default=None)
    op.alter_column('ranking', 'esta_en_ranking', server_default=None)
