"""retirar catalogo sembrado de categoria_horario

Revision ID: 5b09fde49560
Revises: p1146recses
Create Date: 2026-09-19 23:51:01.510404

Decisión del dueño (issue #1362, reporte sobre staging con base limpia el
2026-09-19): "la idea sería que inicie vacío sin ningún horario". Las 5
categorías fijas que `a4e7c2f9b1d8` sembraba en toda base nueva
(FORMATIVO/INFANTIL/JUVENIL/COMPETITIVO/ADULTOS) dejan de ser dato de
producto -- el admin las crea a mano desde `/groups` ("Nueva categoría",
docs/archive/fixes/24-abm-categorias.md). De acá en más quedan como fixture
de dev/test únicamente (ver `scripts/catalogo_default.py`, que sigue
describiéndolas para quien las necesita).

Esta migración retira las 5 filas sembradas SOLO donde nada las usa:
producción ya tiene `horario_entrenamiento` reales apuntando a ellas (y
alumnos/asistencias colgando de esos horarios), así que borrarlas ahí
rompería la FK y perdería historial real. Staging (reaprovisionada vacía el
mismo 2026-09-19, ver docs/operations/staging-redeploy.md) y toda base
nueva no tienen ningún horario todavía, así que las 5 salen limpias.

Por `codigo`, no en bloque: una categoría sembrada puede estar en uso
mientras las otras cuatro no (caso de test (b) en
`test_migracion_catalogo_vacio.py`), y una base real puede tener el admin ya
usando solo 2 de las 5. `categoria_horario_dia` se borra primero -- es lo
que la FK de `a4e7c2f9b1d8` exige antes de poder borrar la fila padre.

Una categoría NO sembrada (creada por el admin, p. ej. "RECREATIVO") nunca
entra al loop de abajo: esta migración no toca nada fuera de las 5 conocidas.

El `downgrade()` es un no-op documentado: resembrar el catálogo reintroduciría
exactamente el dato de producto que esta migración retira, y la decisión del
dueño no es "temporal, hasta revertir" -- una base que baja esta revisión se
queda con `categoria_horario` como estuviera (vacío en una instalación nueva;
intacto en producción, que nunca pierde sus filas en uso).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5b09fde49560'
down_revision: Union[str, Sequence[str], None] = 'p1146recses'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Copia literal de los `codigo` que siembra `a4e7c2f9b1d8` -- ver
# `scripts/catalogo_default.py` para la definición completa (label/horas/
# días/edades), que esta migración no necesita.
_CATEGORIAS_SEMBRADAS = ('FORMATIVO', 'INFANTIL', 'JUVENIL', 'COMPETITIVO', 'ADULTOS')


def _retirar_catalogo_sembrado(conn) -> None:
    """Borra, de las 5 categorías sembradas, solo las que NINGÚN
    `horario_entrenamiento` referencia. Función pura respecto de `op` (toma
    una conexión) para poder probarla contra una base real sin pasar por el
    motor de Alembic -- ver `test_migracion_catalogo_vacio.py`."""
    for codigo in _CATEGORIAS_SEMBRADAS:
        en_uso = conn.execute(
            sa.text("SELECT 1 FROM horario_entrenamiento WHERE categoria = :codigo LIMIT 1"),
            {"codigo": codigo},
        ).first()
        if en_uso is not None:
            continue
        conn.execute(
            sa.text("DELETE FROM categoria_horario_dia WHERE categoria_codigo = :codigo"),
            {"codigo": codigo},
        )
        conn.execute(
            sa.text("DELETE FROM categoria_horario WHERE codigo = :codigo"),
            {"codigo": codigo},
        )


def upgrade() -> None:
    """Upgrade schema."""
    _retirar_catalogo_sembrado(op.get_bind())


def downgrade() -> None:
    """Downgrade schema."""
    # No-op documentado -- ver el docstring del módulo.
    pass
