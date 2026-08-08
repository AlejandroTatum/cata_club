"""crear tabla categoria_horario y FK desde horario_entrenamiento

Revision ID: a4e7c2f9b1d8
Revises: b8dacaddb73b
Create Date: 2026-08-07 00:00:00.000000

Primer paso de dos (ver `c6b3e8f2a5d9`, la que sigue): mueve las 5
categorías fijas de horario -- hoy un `dict` en memoria en
`app.dominio.categoria_metadata.CATEGORIA_METADATA` -- a una tabla real,
para que el club pueda sumar una categoría nueva sin un deploy de código.

Crea `categoria_horario` (codigo/label/hora_inicio/hora_fin) y
`categoria_horario_dia` (categoria -> día permitido). Se modela como tabla
relacional, no como columna array, para reutilizar el mismo tipo Postgres
`diasemana` que ya usa `horario_entrenamiento.dia_semana` y quedar
consultable/constreñida por FK igual que el resto del esquema. Puebla las
5 filas con una copia literal de `categoria_metadata.py:33-54`.

Agrega `horario_entrenamiento.categoria_codigo` (nullable, con índice de
cobertura) y la rellena (backfill) desde la columna enum `categoria`
existente vía `::text`. Se queda NULLABLE a propósito -- éste es el paso
"expand" del patrón expand/migrate/contract: el servicio TODAVÍA crea
horarios por el camino viejo (`categoria` enum) sin tocar esta columna
nueva, así que forzar NOT NULL acá rompería cualquier alta hecha entre este
PR y el de cutover. La columna enum vieja tampoco se toca -- nada se borra
en la misma migración que lo reemplaza. La migración siguiente
(`c6b3e8f2a5d9`, el cutover) re-backfillea cualquier fila creada en el medio
y recién ahí vuelve `categoria_codigo` NOT NULL.
"""
from datetime import time
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4e7c2f9b1d8'
down_revision: Union[str, Sequence[str], None] = 'b8dacaddb73b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_LUN_VIE = ('LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES')
_LUN_SAB = _LUN_VIE + ('SABADO',)

# Copia literal de `app/dominio/categoria_metadata.py:33-54`.
_CATEGORIAS = [
    ('FORMATIVO', 'Formativo', time(15, 0), time(16, 0), _LUN_VIE),
    ('INFANTIL', 'Infantil', time(16, 0), time(17, 0), _LUN_VIE),
    ('JUVENIL', 'Juvenil', time(17, 0), time(18, 0), _LUN_VIE),
    ('COMPETITIVO', 'Competitivo', time(18, 0), time(20, 0), _LUN_SAB),
    ('ADULTOS', 'Adultos', time(20, 0), time(21, 15), _LUN_VIE),
]


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'categoria_horario',
        sa.Column('codigo', sa.String(length=20), nullable=False),
        sa.Column('label', sa.String(length=50), nullable=False),
        sa.Column('hora_inicio', sa.Time(), nullable=False),
        sa.Column('hora_fin', sa.Time(), nullable=False),
        sa.PrimaryKeyConstraint('codigo'),
    )
    # Tabla cruda por SQL (no `op.create_table` con un `sa.Enum` inline):
    # `dia_semana` reutiliza el tipo Postgres `diasemana` que ya existe
    # (creado por `c8722261ea5b`) y, aun con `create_type=False`,
    # `op.create_table` intenta re-emitir `CREATE TYPE diasemana` y falla con
    # `DuplicateObject` -- referenciar el tipo por nombre en SQL crudo lo evita.
    op.execute(
        "CREATE TABLE categoria_horario_dia ("
        "categoria_codigo VARCHAR(20) NOT NULL REFERENCES categoria_horario (codigo), "
        "dia_semana diasemana NOT NULL, "
        "PRIMARY KEY (categoria_codigo, dia_semana)"
        ")"
    )

    bind = op.get_bind()
    categoria_tabla = sa.table(
        'categoria_horario',
        sa.column('codigo', sa.String),
        sa.column('label', sa.String),
        sa.column('hora_inicio', sa.Time),
        sa.column('hora_fin', sa.Time),
    )
    for codigo, label, hora_inicio, hora_fin, dias in _CATEGORIAS:
        bind.execute(
            categoria_tabla.insert().values(
                codigo=codigo, label=label, hora_inicio=hora_inicio, hora_fin=hora_fin,
            )
        )
        # `dia_semana` es un enum Postgres (`diasemana`): igual que en
        # `b7f3c1a9d2e4`, un `.values()` de Core con un bind param de texto
        # falla con DatatypeMismatch aunque la columna declare `sa.Enum` --
        # hace falta el cast explícito `::diasemana` en SQL crudo.
        for dia in dias:
            bind.execute(
                sa.text(
                    "INSERT INTO categoria_horario_dia (categoria_codigo, dia_semana) "
                    "VALUES (:codigo, :dia ::diasemana)"
                ),
                {"codigo": codigo, "dia": dia},
            )

    with op.batch_alter_table('horario_entrenamiento', schema=None) as batch_op:
        batch_op.add_column(sa.Column('categoria_codigo', sa.String(length=20), nullable=True))
        batch_op.create_foreign_key(
            'fk_horario_entrenamiento_categoria_codigo',
            'categoria_horario', ['categoria_codigo'], ['codigo'],
        )

    # Cobertura de índice para la FK nueva (ver `test_indices_fk.py`, regla
    # nacida en `faaadef2afa8`) -- se crea acá, no en el cutover, porque la
    # columna ya queda mapeada en el ORM en ESTE PR (ver `CategoriaHorario`
    # y el comentario en `HorarioEntrenamiento.categoria_codigo`).
    op.create_index(
        'ix_horario_entrenamiento_categoria_codigo', 'horario_entrenamiento', ['categoria_codigo'],
    )

    op.execute("UPDATE horario_entrenamiento SET categoria_codigo = categoria::text")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_horario_entrenamiento_categoria_codigo', table_name='horario_entrenamiento')
    with op.batch_alter_table('horario_entrenamiento', schema=None) as batch_op:
        batch_op.drop_column('categoria_codigo')
    op.drop_table('categoria_horario_dia')
    op.drop_table('categoria_horario')
