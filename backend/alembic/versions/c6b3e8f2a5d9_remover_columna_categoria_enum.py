"""cutover: categoria pasa a ser la FK, se remueve el enum viejo

Revision ID: c6b3e8f2a5d9
Revises: a4e7c2f9b1d8
Create Date: 2026-08-08 00:00:00.000000

Segundo paso (ver `a4e7c2f9b1d8`, el "expand"): el modelo/servicio/schemas/
router ya leen `categoria_horario` en este PR, así que esta migración hace
el "migrate/contract" del patrón expand/migrate/contract.

1. Re-backfillea `categoria_codigo` por si algún horario se creó por el
   camino viejo entre el merge del PR "expand" y este (esa columna se dejó
   NULLABLE a propósito ahí, justamente para tolerar esa ventana) y recién
   ahí la vuelve NOT NULL.
2. Saca la columna enum vieja `categoria` y renombra `categoria_codigo` ->
   `categoria`, para que el atributo del ORM no cambie de nombre.
3. Recrea el índice de cobertura de la FK con el nombre final (el del paso
   "expand" apuntaba a `categoria_codigo`).
4. Dropea el tipo Postgres `categoria` (el enum), que ya no lo referencia
   ninguna columna.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c6b3e8f2a5d9'
down_revision: Union[str, Sequence[str], None] = 'a4e7c2f9b1d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CATEGORIAS_CONOCIDAS = ('FORMATIVO', 'INFANTIL', 'JUVENIL', 'COMPETITIVO', 'ADULTOS')


def upgrade() -> None:
    """Upgrade schema."""
    # Straggler guard: el paso "expand" dejó `categoria_codigo` NULLABLE
    # justamente para tolerar un horario creado por el camino viejo entre
    # ese PR y este. Re-backfillear antes de exigir NOT NULL es lo que
    # honra esa promesa en vez de romper con una fila real de producción.
    op.execute(
        "UPDATE horario_entrenamiento SET categoria_codigo = categoria::text "
        "WHERE categoria_codigo IS NULL"
    )

    with op.batch_alter_table('horario_entrenamiento', schema=None) as batch_op:
        batch_op.alter_column('categoria_codigo', nullable=False)
        batch_op.drop_column('categoria')
        batch_op.alter_column('categoria_codigo', new_column_name='categoria')

    # El índice de cobertura del paso "expand" apuntaba a `categoria_codigo`
    # -- se recrea con el nombre final ahora que la columna es `categoria`.
    op.drop_index('ix_horario_entrenamiento_categoria_codigo', table_name='horario_entrenamiento')
    op.create_index(
        'ix_horario_entrenamiento_categoria', 'horario_entrenamiento', ['categoria'],
    )

    sa.Enum(name='categoria').drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    """Downgrade schema."""
    sa.Enum(
        'FORMATIVO', 'INFANTIL', 'JUVENIL', 'COMPETITIVO', 'ADULTOS',
        name='categoria',
    ).create(op.get_bind(), checkfirst=True)

    op.drop_index('ix_horario_entrenamiento_categoria', table_name='horario_entrenamiento')

    with op.batch_alter_table('horario_entrenamiento', schema=None) as batch_op:
        batch_op.alter_column('categoria', new_column_name='categoria_codigo')

    op.create_index(
        'ix_horario_entrenamiento_categoria_codigo', 'horario_entrenamiento', ['categoria_codigo'],
    )

    with op.batch_alter_table('horario_entrenamiento', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'categoria',
                sa.Enum('FORMATIVO', 'INFANTIL', 'JUVENIL', 'COMPETITIVO', 'ADULTOS', name='categoria'),
                nullable=True,
            )
        )

    # Backfill igual que `b7f3c1a9d2e4`: cast explícito `::categoria`, sin
    # fallback silencioso -- si se creó una categoría nueva después de migrar
    # a tabla (el motivo de este cambio), el downgrade no puede representarla
    # en el enum viejo y debe fallar ruidosamente en vez de perder el dato.
    bind = op.get_bind()
    horario_tabla = sa.table(
        'horario_entrenamiento',
        sa.column('id', sa.Integer),
        sa.column('categoria_codigo', sa.String),
    )
    filas = bind.execute(sa.select(horario_tabla.c.id, horario_tabla.c.categoria_codigo)).fetchall()
    for fila_id, codigo in filas:
        if codigo not in _CATEGORIAS_CONOCIDAS:
            raise ValueError(
                f"No se puede volver al enum: categoria_codigo={codigo!r} no es una "
                f"de las {_CATEGORIAS_CONOCIDAS} conocidas por el enum viejo -- esta "
                "fila se creó después de migrar a tabla y el downgrade no puede "
                "representarla; investigar antes de bajar la migración."
            )
        bind.execute(
            sa.text("UPDATE horario_entrenamiento SET categoria = :categoria ::categoria WHERE id = :id"),
            {"categoria": codigo, "id": fila_id},
        )

    # Vuelve al estado exacto de fin del paso "expand": `categoria` (enum)
    # NOT NULL y `categoria_codigo` NULLABLE otra vez (así queda si se
    # downgradea también `a4e7c2f9b1d8` a continuación).
    with op.batch_alter_table('horario_entrenamiento', schema=None) as batch_op:
        batch_op.alter_column('categoria', nullable=False)
        batch_op.alter_column('categoria_codigo', nullable=True)
