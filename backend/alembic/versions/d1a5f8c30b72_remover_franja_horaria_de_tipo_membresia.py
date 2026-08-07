"""remover franja_horaria de tipo_membresia

Revision ID: d1a5f8c30b72
Revises: faaadef2afa8
Create Date: 2026-08-06 00:00:00.000000

`tipo_membresia.franja_horaria` era un `String(80)` cargado a mano que
duplicaba, sin nada que los mantuviera sincronizados, un horario que ya vive
en `horario_entrenamiento` (derivado a su vez de
`app.dominio.categoria_metadata.CATEGORIA_METADATA`). La copia se
desincronizó: el plan "Mensual Adultos" declaraba `20:00-21:00` mientras la
categoría ADULTOS entrena de 20:00 a 21:15, y el carnet del alumno y su lista
de próximos entrenamientos mostraban horas distintas en una misma pantalla.

La franja no es un atributo del plan: un plan es un precio. La franja del
alumno se deriva ahora de los `alumno_horario` que el club le asignó (ver
`frontend/src/app/student/student-utils.ts::describeAssignedWindows`), que es
la misma fuente de la que sale el listado de entrenamientos -- por
construcción no pueden discrepar.

Downgrade: recrea la columna NOT NULL con `''` en las filas existentes. No
intenta reconstruir el texto original: no quedó ninguna fuente de la cual
derivarlo (la asociación plan -> horas nunca existió en la base, era el propio
texto libre que esta migración elimina). Inventar un rango sería exactamente
el defecto que la migración cierra.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd1a5f8c30b72'
down_revision: Union[str, Sequence[str], None] = 'faaadef2afa8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('tipo_membresia', 'franja_horaria')


def downgrade() -> None:
    # `server_default` solo para poder poner NOT NULL sobre las filas que ya
    # existen; se retira enseguida para dejar la columna tal como estaba antes
    # (sin default), que es lo que el test de drift compara.
    op.add_column(
        'tipo_membresia',
        sa.Column('franja_horaria', sa.String(length=80), nullable=False, server_default=''),
    )
    op.alter_column('tipo_membresia', 'franja_horaria', server_default=None)
