"""indices de cobertura fk

Revision ID: faaadef2afa8
Revises: e7c3a1b9d5f2
Create Date: 2026-08-03 00:00:00.000000

Crea un índice para cada una de las 21 columnas FK de `Base.metadata` que
hasta ahora no tenían cobertura de índice utilizable (ni PK, ni
UniqueConstraint, ni Index no parcial) -- sdd/database-index-coverage.
Sin esto, cada JOIN/filtro por esas columnas (borrado en cascada,
listados por persona/membresía/horario, etc.) fuerza un sequential scan.

Las 21 columnas y sus índices están enumeradas en `modelos.py`
(`__table_args__` de cada clase, o posicional en la `Table` de
`usuario_rol`) -- ese es el inventario canónico y legible por diagrama;
acá se derivan de una única tupla para que `upgrade()`/`downgrade()` sean
simétricos por construcción.

`upgrade()` y `downgrade()` usan `op.create_index`/`op.drop_index` planos,
dentro de la transacción normal de la migración (sin
`autocommit_block()`, sin `CONCURRENTLY`): al volumen actual (~decenas de
filas por tabla) el costo de un `ACCESS EXCLUSIVE` breve es insignificante.
Cuando las tablas crezcan lo suficiente para que ese lock importe, el
patrón correcto es `CREATE INDEX CONCURRENTLY` envuelto en
`op.get_context().autocommit_block()` -- un `autocommit_block()` por
índice, porque `CONCURRENTLY` no puede correr dentro de una transacción
(precedente: `b3d7e5f1a9c2:48-52`, usado ahí para `ALTER TYPE ... ADD
VALUE`). No se usa ahora porque un build fallido de un índice
`CONCURRENTLY` queda `INVALID` y exige `DROP INDEX` manual -- no hay
rollback atómico -- una complejidad desproporcionada a este volumen.

Downgrade: elimina exactamente los mismos 21 índices, en orden inverso,
dejando el esquema idéntico al estado previo a esta migración.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'faaadef2afa8'
down_revision: Union[str, Sequence[str], None] = 'e7c3a1b9d5f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (tabla, columna) -- inventario canónico, ver modelos.py para el detalle
# por clase. El orden sigue la declaración en modelos.py.
_INDICES_FK: tuple[tuple[str, str], ...] = (
    ("usuario_rol", "rol_id"),
    ("provincia", "pais_id"),
    ("canton", "provincia_id"),
    ("direccion", "canton_id"),
    ("persona", "representante_id"),
    ("persona", "direccion_id"),
    ("persona", "institucion_id"),
    ("membresia", "persona_id"),
    ("membresia", "tipo_membresia_id"),
    ("pago", "persona_id"),
    ("pago", "membresia_id"),
    ("descuento_aplicado", "pago_id"),
    ("descuento_aplicado", "descuento_id"),
    ("descuento_aplicado", "persona_id"),
    ("descuento_aplicado", "autorizado_por_persona_id"),
    ("asistencia", "persona_id"),
    ("asistencia", "horario_id"),
    ("alumno_horario", "horario_id"),
    ("enfermedades", "ficha_medica_id"),
    ("ranking", "nivel_ranking_id"),
    ("notificacion", "persona_id"),
)


def upgrade() -> None:
    for tabla, columna in _INDICES_FK:
        op.create_index(f"ix_{tabla}_{columna}", tabla, [columna])


def downgrade() -> None:
    for tabla, columna in reversed(_INDICES_FK):
        op.drop_index(f"ix_{tabla}_{columna}", table_name=tabla)
