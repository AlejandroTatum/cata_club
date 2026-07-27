"""columnas datetime a timestamptz

Revision ID: a7c1e9d4f6b2
Revises: 644d352bf590
Create Date: 2026-07-26 12:40:00.000000

Convierte las 10 columnas de fecha-hora del modelo de `timestamp without
time zone` a `timestamptz`.

Bug que cierra:
    `_ahora_utc()` (`app/dominio/modelos.py`) siempre produjo un datetime
    AWARE en UTC, pero las columnas eran naive. Postgres descarta el offset
    al guardar: convierte el valor a la zona de la SESIÓN y guarda el reloj
    de pared resultante. Que hoy los instantes sean correctos depende de que
    los contenedores corran en UTC — es una coincidencia de configuración,
    no una garantía del esquema. Con `timestamptz` el instante queda
    almacenado sin ambigüedad y SQLAlchemy lo devuelve aware.

Por qué `USING columna AT TIME ZONE 'UTC'` NO es opcional:
    Sin esa cláusula, `ALTER COLUMN ... TYPE timestamptz` reinterpreta cada
    valor naive existente en la zona del servidor. Si el servidor no está en
    UTC, cada instante ya guardado se correría (5 horas en el caso de
    `America/Guayaquil`) y el error quedaría horneado en los datos de forma
    permanente. Los datos existentes ya son UTC, así que hay que decírselo
    explícitamente a Postgres.

    `AT TIME ZONE 'UTC'` sobre un `timestamp` naive significa "este reloj de
    pared está en UTC" y produce el `timestamptz` correcto. En el
    `downgrade()` el mismo operador, aplicado ahora sobre un `timestamptz`,
    significa lo contrario ("dame el reloj de pared en UTC") y devuelve el
    valor naive original — la conversión es simétrica y no pierde datos.

Cobertura:
    `backend/tests/test_migracion_timestamptz.py` corre esta migración con
    el arnés de `backend/tests/arnes_migraciones.py` sobre filas
    preexistentes Y con el servidor en `America/Guayaquil`, de modo que
    olvidar el `AT TIME ZONE 'UTC'` rompe la suite en vez de llegar a
    producción.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a7c1e9d4f6b2'
down_revision: Union[str, Sequence[str], None] = '644d352bf590'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Las 10 columnas `DateTime` de `app/dominio/modelos.py`. Se listan aquí
# explícitamente (y no por introspección) para que agregar una columna nueva
# obligue a decidir conscientemente si también es un instante.
COLUMNAS_FECHA_HORA: Sequence[tuple[str, str]] = (
    ("usuario", "fecha_creacion"),
    ("persona", "fecha_registro"),
    ("membresia", "fecha_activacion"),
    ("pago", "fecha_registro"),
    ("pago", "fecha_validacion"),
    ("pago", "voucher_fecha_carga"),
    ("comprobante_pago", "fecha_carga"),
    ("asistencia", "fecha_registro"),
    ("alumno_horario", "fecha_asignacion"),
    ("notificacion", "fecha_creacion"),
)


def upgrade() -> None:
    """Upgrade schema."""
    for tabla, columna in COLUMNAS_FECHA_HORA:
        op.execute(
            f'ALTER TABLE "{tabla}" ALTER COLUMN "{columna}" '
            f"TYPE timestamptz USING \"{columna}\" AT TIME ZONE 'UTC'"
        )


def downgrade() -> None:
    """Downgrade schema."""
    for tabla, columna in COLUMNAS_FECHA_HORA:
        op.execute(
            f'ALTER TABLE "{tabla}" ALTER COLUMN "{columna}" '
            f"TYPE timestamp USING \"{columna}\" AT TIME ZONE 'UTC'"
        )
