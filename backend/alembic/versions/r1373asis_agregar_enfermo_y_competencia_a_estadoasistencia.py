"""agregar ENFERMO y COMPETENCIA al enum estadoasistencia

Revision ID: r1373asis
Revises: r1372galeria
Create Date: 2026-09-24 00:00:00.000000

Añade los dos estados de inasistencia autorizada del issue #1373 al enum
PostgreSQL ``estadoasistencia``:

  * ``ENFERMO``: el alumno no entrenó por enfermedad.
  * ``COMPETENCIA``: el alumno no entrenó por competencia deportiva.

Ninguno de los dos es una ausencia injustificada -- la estadística los trata
como familia justificada/neutral (ver
``AsistenciaServicio.listar_ultimas_listas``), y el enum de dominio
``app/dominio/enums.py::EstadoAsistencia`` los documenta con el mismo
criterio. El tipo PG también respalda ``correccion_asistencia.estado_anterior``
(migración ``300423734f25``), así que ambas columnas pasan a aceptar los dos
valores nuevos con esta única migración.

Notas técnicas (PostgreSQL), mismo patrón que ``o1145cupomail``
(``RESUMEN_CUPO_CORREO_ADMIN``), ``798bfa9ae35e`` y ``b3d7e5f1a9c2``:
  * ``ALTER TYPE ... ADD VALUE`` no puede ejecutarse dentro de un bloque
    transaccional cuando el tipo ya está en uso; se envuelve con
    ``op.get_context().autocommit_block()``.
  * ``IF NOT EXISTS`` mantiene la migración idempotente.
  * Los dos ``ADD VALUE`` van en el MISMO autocommit block: entre valores del
    MISMO ``ALTER TYPE`` no hay problema; separarlos en dos bloques también
    sería válido, pero un solo bloque deja los dos valores en el mismo punto
    de la historia.
  * El ``downgrade`` es intencionalmente un no-op: PostgreSQL no soporta
    ``ALTER TYPE ... DROP VALUE`` sin recrear el tipo y reescribir ambas
    columnas que lo usan, operación destructiva sobre asistencias y
    correcciones reales.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'r1373asis'
down_revision: Union[str, Sequence[str], None] = 'r1372galeria'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Añadir ENFERMO y COMPETENCIA al enum estadoasistencia."""
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE estadoasistencia "
            "ADD VALUE IF NOT EXISTS 'ENFERMO'"
        )
        op.execute(
            "ALTER TYPE estadoasistencia "
            "ADD VALUE IF NOT EXISTS 'COMPETENCIA'"
        )


def downgrade() -> None:
    """No-op deliberado: ver el docstring del módulo."""
    pass
