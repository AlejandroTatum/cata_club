"""indices de consultas reales

Revision ID: d4f8c2a6b0e3
Revises: a790verifcorreo
Create Date: 2026-08-29 00:00:00.000000

Alinea los índices con las consultas que el sistema REALMENTE corre (issue
#811). `faaadef2afa8` cubrió las columnas FK una por una; esto agrega los
COMPUESTOS que esas consultas necesitan -- filtro por igualdad más rango u
orden sobre una segunda columna -- y retira los simples que quedaron
redundantes.

Los 9 índices nuevos anteponen siempre la columna de IGUALDAD y dejan
después la de rango/orden: es el único orden que sirve al `WHERE` y al
`ORDER BY` en el mismo recorrido. Ninguno lleva `DESC` explícito, porque un
btree se recorre para atrás al mismo costo y un índice ASC ya sirve un
`ORDER BY ... DESC`. Cada uno está justificado por una consulta concreta,
citada en el `__table_args__` de su clase en `modelos.py` y verificada
contra el catálogo de Postgres en `tests/test_indices_consultas_reales.py`.

Los 6 índices que se retiran quedaron redundantes por la misma regla que
gobierna a `test_indices_fk.py`: un índice `(a, b)` sirve `WHERE a` por su
columna más a la izquierda, así que mantener además `(a)` es costo de
escritura y de espacio sin ninguna consulta que lo prefiera.

- `ix_horario_entrenamiento_categoria` y `ix_enrollment_notif_outbox_admin`:
  su columna ya era la primera de un UniqueConstraint NO parcial
  (`uq_horario_categoria_dia` y `uq_enrollment_notif_outbox_admin_alumno`
  respectivamente). Ya eran redundantes antes de esta migración.
- `ix_pago_persona_id`, `ix_notificacion_persona_id`,
  `ix_asistencia_persona_id` e `ix_asistencia_horario_id`: NO están
  enumerados en el issue, y se retiran igual porque los compuestos nuevos
  los vuelven redundantes en el mismo acto de crearlos. Cada una de esas
  cuatro columnas pasa a ser la más a la izquierda de un índice nuevo no
  parcial (`ix_pago_persona_fecha_registro`,
  `ix_notificacion_persona_fecha_creacion`,
  `ix_asistencia_persona_fecha_entrenamiento` e
  `ix_asistencia_horario_fecha_entrenamiento`), así que su cobertura de FK
  no se pierde y `test_indices_fk.py` sigue en verde. Dejarlos sería
  duplicar el prefijo de un índice que ya existe.

`upgrade()` y `downgrade()` se derivan de dos únicas tuplas
(`_INDICES_NUEVOS` y `_INDICES_RETIRADOS`), para que sean simétricos por
construcción: el downgrade recrea los 6 con su definición original y elimina
los 9, dejando el esquema idéntico al estado previo.

Como en `faaadef2afa8`, se usan `op.create_index`/`op.drop_index` PLANOS,
dentro de la transacción normal de la migración (sin `autocommit_block()`,
sin `CONCURRENTLY`): al volumen actual (~decenas de filas por tabla) el
costo de un `ACCESS EXCLUSIVE` breve es insignificante, y un build fallido
de un índice `CONCURRENTLY` queda `INVALID` exigiendo `DROP INDEX` manual
-- no hay rollback atómico. Cuando las tablas crezcan lo suficiente para
que ese lock importe, el patrón correcto es `CREATE INDEX CONCURRENTLY`
envuelto en `op.get_context().autocommit_block()`, un bloque POR ÍNDICE,
porque `CONCURRENTLY` no puede correr dentro de una transacción.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd4f8c2a6b0e3'
down_revision: Union[str, Sequence[str], None] = 'a790verifcorreo'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (nombre, tabla, columnas en orden) -- inventario canónico de los índices
# que esta migración CREA. Ver `modelos.py` para la consulta que justifica
# cada uno.
_INDICES_NUEVOS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("ix_pago_estado_fecha_registro", "pago", ("estado_pago", "fecha_registro")),
    ("ix_pago_persona_fecha_registro", "pago", ("persona_id", "fecha_registro")),
    (
        "ix_pago_estado_membresia_fecha_fin",
        "pago",
        ("estado_pago", "membresia_id", "fecha_fin"),
    ),
    ("ix_pago_estado_fecha_fin", "pago", ("estado_pago", "fecha_fin")),
    ("ix_pago_estado_fecha_validacion", "pago", ("estado_pago", "fecha_validacion")),
    (
        "ix_notificacion_persona_fecha_creacion",
        "notificacion",
        ("persona_id", "fecha_creacion"),
    ),
    (
        "ix_asistencia_persona_fecha_entrenamiento",
        "asistencia",
        ("persona_id", "fecha_entrenamiento"),
    ),
    (
        "ix_asistencia_horario_fecha_entrenamiento",
        "asistencia",
        ("horario_id", "fecha_entrenamiento"),
    ),
    ("ix_persona_fecha_registro", "persona", ("fecha_registro",)),
)


# (nombre, tabla, columnas en orden) -- índices que esta migración ELIMINA,
# con su definición ORIGINAL: es de esta misma tupla que `downgrade()` los
# recrea, así que el estado previo se restaura exactamente.
_INDICES_RETIRADOS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("ix_horario_entrenamiento_categoria", "horario_entrenamiento", ("categoria",)),
    (
        "ix_enrollment_notif_outbox_admin",
        "enrollment_notificacion_outbox",
        ("admin_persona_id",),
    ),
    ("ix_asistencia_persona_id", "asistencia", ("persona_id",)),
    ("ix_pago_persona_id", "pago", ("persona_id",)),
    ("ix_notificacion_persona_id", "notificacion", ("persona_id",)),
    ("ix_asistencia_horario_id", "asistencia", ("horario_id",)),
)


def upgrade() -> None:
    for nombre, tabla, columnas in _INDICES_NUEVOS:
        op.create_index(nombre, tabla, list(columnas))
    for nombre, tabla, _columnas in _INDICES_RETIRADOS:
        op.drop_index(nombre, table_name=tabla)


def downgrade() -> None:
    for nombre, tabla, columnas in reversed(_INDICES_RETIRADOS):
        op.create_index(nombre, tabla, list(columnas))
    for nombre, tabla, _columnas in reversed(_INDICES_NUEVOS):
        op.drop_index(nombre, table_name=tabla)
