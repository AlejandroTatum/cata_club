"""estado SUSPENDIDA + historial auditable de transiciones de membresía

Revision ID: d2a7e5c91b34
Revises: c1f4b8e2a706
Create Date: 2026-08-18 00:10:00.000000

Issue #400: reconstrucción del ciclo de membresía, tarifas y cobertura.

Dos hechos nuevos, y el segundo existe porque el primero sin él sería peor
que nada:

  1. `SUSPENDIDA` en el enum `estadomembresia`. El club necesita parar la
     generación de deuda de alguien que se ausenta un tiempo sin que pierda
     su plan, su beneficio ni su cobertura ya pagada. NO es un cuarto sabor
     de "vencida": una VENCIDA debe plata, una SUSPENDIDA no acumula ninguna.
  2. `historial_estado_membresia`. Sin esta tabla, suspender sería un cambio
     de estado sin autor y sin motivo -- el mismo defecto que #389 documenta
     del otro lado del sistema, donde una asistencia corregida quedaba
     acreditada a quien no la escribió. El original nunca se sobrescribe:
     cada transición es una fila nueva.

Sobre el índice parcial que NO se toca
--------------------------------------
`uq_membresia_activa_por_persona` (migración `c3d9f2b7a1e5`) restringe con
`WHERE estado = 'ACTIVA'`. Agregar un estado al enum no lo altera y no debe
alterarlo: una SUSPENDIDA tiene que poder convivir con la ACTIVA de la misma
persona, igual que ya conviven las VENCIDAS y las INACTIVAS del historial.
Los candados de `tests/test_estado_y_historial_membresia.py` fijan las dos
direcciones (convivencia permitida, dos ACTIVAS prohibidas).

`ALTER TYPE ... ADD VALUE` no puede correr dentro de un bloque transaccional
cuando el tipo ya está en uso, así que se envuelve con
`op.get_context().autocommit_block()`, igual que `a9b8c7d6e5f4` y
`a3b4c5d6e7f8`. El valor nuevo NO se usa en esta misma migración -- la tabla
solo referencia el TIPO, no el label.

Sobre `actor_persona_id` y `motivo` nullable: el vencimiento lo dispara el
sistema, no una persona. Que toda transición ADMINISTRATIVA lleve actor y
motivo lo exige el servicio, que es quien conoce la diferencia; la tabla no
puede distinguir un actor ausente legítimo de uno olvidado.

El downgrade borra la tabla. El valor del enum no se revierte: PostgreSQL no
permite quitar un label de un enum (mismo criterio que `a9b8c7d6e5f4` y
`d5e6f7a8b9c1`).
"""

from alembic import op
import sqlalchemy as sa


revision = "d2a7e5c91b34"
down_revision = "c1f4b8e2a706"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_context().autocommit_block()
    op.execute("ALTER TYPE estadomembresia ADD VALUE IF NOT EXISTS 'SUSPENDIDA'")

    # Tabla cruda por SQL, no `op.create_table` con un `sa.Enum` inline: las
    # dos columnas de estado reutilizan el tipo Postgres `estadomembresia`
    # que ya existe (creado por `c8722261ea5b`) y, aun con
    # `create_type=False`, `op.create_table` intenta re-emitir
    # `CREATE TYPE estadomembresia` y falla con `DuplicateObject`.
    # Referenciar el tipo por nombre en SQL crudo lo evita. Mismo problema y
    # misma salida que `a4e7c2f9b1d8` con `diasemana`, donde ya está
    # documentado.
    op.execute(
        "CREATE TABLE historial_estado_membresia ("
        "id SERIAL PRIMARY KEY, "
        "membresia_id INTEGER NOT NULL REFERENCES membresia (id), "
        "estado_anterior estadomembresia NOT NULL, "
        "estado_nuevo estadomembresia NOT NULL, "
        "fecha_efectiva TIMESTAMPTZ NOT NULL, "
        "fecha_registro TIMESTAMPTZ NOT NULL, "
        "actor_persona_id INTEGER REFERENCES persona (id), "
        "motivo VARCHAR(255), "
        "CONSTRAINT ck_historial_estado_cambia "
        "CHECK (estado_anterior <> estado_nuevo)"
        ")"
    )
    op.create_index(
        "ix_historial_estado_membresia_membresia_id",
        "historial_estado_membresia",
        ["membresia_id"],
    )
    op.create_index(
        "ix_historial_estado_membresia_actor_persona_id",
        "historial_estado_membresia",
        ["actor_persona_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_historial_estado_membresia_actor_persona_id",
        table_name="historial_estado_membresia",
    )
    op.drop_index(
        "ix_historial_estado_membresia_membresia_id",
        table_name="historial_estado_membresia",
    )
    op.drop_table("historial_estado_membresia")
    # PostgreSQL no permite quitar un valor de un enum; SUSPENDIDA no se
    # revierte (mismo criterio que a9b8c7d6e5f4 y d5e6f7a8b9c1).
