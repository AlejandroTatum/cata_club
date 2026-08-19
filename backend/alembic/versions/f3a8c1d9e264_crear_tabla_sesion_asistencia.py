"""crear tabla sesion_asistencia

Revision ID: f3a8c1d9e264
Revises: de1413036789
Create Date: 2026-08-18 00:00:00.000000

Issue #389, slice 1 de la cadena "asistencias: cierre auditable": agrega el
CIERRE ATÓMICO de una sesión de asistencia, donde "sesión" es el par
(`horario_id`, `fecha_entrenamiento`) -- `asistencia` no tenía hasta ahora
ningún concepto de sesión propio.

El `UniqueConstraint("horario_id", "fecha_entrenamiento")` es la pieza que
hace el cierre RACE-SAFE: dos requests concurrentes intentando cerrar la
misma sesión por primera vez solo pueden lograr que UNA de las dos filas se
inserte -- la otra recibe el `IntegrityError` del UNIQUE y relee la fila que
la ganadora ya creó (`SesionAsistenciaRepositorio.obtener_o_crear_cerrada`).
Mismo patrón que `uq_horario_categoria_dia` (migración `b7e4a9f2c6d1`).

`cerrada_por_id` es NOT NULL: a diferencia de `asistencia.registrado_por_id`
(nullable por filas históricas previas a esa columna, issue #263), esta
tabla nace vacía junto con esta migración -- no hay ninguna fila histórica
sin autor que preservar.

Sin `ondelete="CASCADE"` en la FK a `persona`: mismo criterio que
`consulta_ficha_emergencia` (migración `de1413036789`) y `sesion` -- salvo
que esta última SÍ tiene cascada porque cascada sobre `usuario.id`, que se
borra duro; `persona` se da de baja LÓGICA (`persona.activo`) y nunca se
borra, así que la cascada nunca dispararía.

Esta migración NO toca ninguna fila de `asistencia`: es puramente aditiva
(una tabla nueva), no reescribe ni backfillea nada del historial existente
(525+ filas de `asistencia` a la fecha de este slice). `sesion_asistencia`
nace vacía -- el servicio (slice siguiente de esta misma cadena) la va a
poblar hacia adelante, en el primer `registrar_asistencia` exitoso de cada
sesión nueva; las sesiones ya tomadas ANTES de este slice no tienen fila de
cierre retroactiva, exactamente igual que `registrado_por_id` no tuvo
backfill falso en su momento.

Downgrade: elimina el índice, el `UniqueConstraint` (implícito al borrar la
tabla) y la tabla, dejando el esquema idéntico al estado previo. Sin
pérdida de datos: la tabla nace vacía y, mientras el downgrade se aplique
antes de que el slice siguiente empiece a escribir en ella, no hay nada que
preservar.

Además, agrega `uq_asistencia_persona_horario_fecha` sobre la tabla
EXISTENTE `asistencia`: el servicio siempre trató (persona_id, horario_id,
fecha_entrenamiento) como clave de upsert, pero nada a nivel de base lo
hacía cumplir. Sin este constraint, dos requests concurrentes para el mismo
alumno podían pasar ambas el chequeo "no existe todavía" del servicio y
crear dos filas -- esquivando el cierre de sesión por timing, exactamente
el tipo de bypass que este slice existe para cerrar. Es aditivo sobre datos
existentes: si las 525+ filas actuales ya son únicas en esa tripleta (el
upsert de `registrar_asistencia` nunca creó una fila duplicada a propósito),
el `ALTER TABLE ... ADD CONSTRAINT` no falla. Si llegara a fallar, es porque
existe una violación de datos histórica que esta migración no debe silenciar
ni resolver adivinando cuál fila es la "correcta" -- hay que investigarla
antes de reintentar el upgrade.

Downgrade de esta segunda parte: elimina el constraint, sin pérdida de
datos (ninguna fila se toca, solo deja de exigirse la unicidad).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'f3a8c1d9e264'
down_revision: Union[str, Sequence[str], None] = 'de1413036789'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sesion_asistencia",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("horario_id", sa.Integer(), nullable=False),
        sa.Column("fecha_entrenamiento", sa.Date(), nullable=False),
        sa.Column("cerrada_por_id", sa.Integer(), nullable=False),
        sa.Column("cerrada_en", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["horario_id"], ["horario_entrenamiento.id"]),
        sa.ForeignKeyConstraint(["cerrada_por_id"], ["persona.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "horario_id", "fecha_entrenamiento", name="uq_sesion_asistencia_horario_fecha",
        ),
    )
    # Cobertura de la FK `cerrada_por_id` (proyecto: toda FK necesita su
    # índice). `horario_id` ya queda cubierto por ser la columna más a la
    # izquierda del UNIQUE creado arriba.
    op.create_index(
        "ix_sesion_asistencia_cerrada_por_id",
        "sesion_asistencia", ["cerrada_por_id"], unique=False,
    )
    op.create_unique_constraint(
        "uq_asistencia_persona_horario_fecha",
        "asistencia", ["persona_id", "horario_id", "fecha_entrenamiento"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_asistencia_persona_horario_fecha", "asistencia", type_="unique",
    )
    op.drop_index("ix_sesion_asistencia_cerrada_por_id", table_name="sesion_asistencia")
    op.drop_table("sesion_asistencia")
