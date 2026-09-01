"""agregar edades a categoria_horario

Revision ID: d4c7e1b09a35
Revises: a839entrega
Create Date: 2026-09-01 00:00:00.000000

Agrega `categoria_horario.edades`: la etiqueta de edades que el club ya
publicaba junto a cada horario ("5 a 10 años", "Selección"). Hasta acá ese
texto vivía FUERA de la base -- repetido en `conocimiento_club.json`, en
`prompt_sistema.txt`, en `frontend/src/data/club-knowledge.json` y en la
lista estática de `landing-config.ts` -- así que el catálogo que sirve la API
era el único lugar donde el horario aparecía sin su etiqueta.

Esta migración NO reconcilia esas copias: las deja intactas y agrega la
etiqueta a la tabla, que pasa a ser un lugar MÁS donde el dato vive. Es el
primer paso de los tres del issue #789 -- recién cuando el frontend consuma
`ages` desde la API y se desarme la lista estática de `landing-config.ts`
queda una sola fuente. Decirlo acá y no después: un comentario que se
adelanta al estado real envejece mal, y este archivo es inmutable una vez
aplicado.

Por qué NULLABLE, y no NOT NULL con `server_default` como en `f2a8c31d9b64`:

  - Ahí la columna era un flag de pertenencia (`persona.activo`) y un NULL
    habría sido un tercer estado sin significado: "¿es miembro?" no admite
    "no sé". Acá no pasa eso. "Esta categoría no publica etiqueta de edades"
    es un estado REAL del negocio -- la etiqueta es texto de orientación
    para la cartelera, no un atributo que toda categoría deba tener. NULL
    representa exactamente ese estado, así que no hay ambigüedad que evitar.
  - Una categoría nueva creada por el admin (`AsistenciaServicio.
    crear_categoria`) puede nacer sin etiqueta y seguir siendo válida: el
    campo es opcional en el alta y se puede limpiar en la edición. Un NOT
    NULL obligaría a inventar un centinela (`''`) para ese caso, y entonces
    convivirían DOS representaciones de "sin etiqueta". El servicio
    normaliza el texto en blanco a NULL justamente para que eso no ocurra.
  - Al ser nullable no hace falta el baile `server_default` -> backfill ->
    `alter_column(server_default=None)`: un `ADD COLUMN` nullable corre sin
    problema sobre una tabla con filas y las deja en NULL. El esquema
    resultante es el que produce `Mapped[Optional[str]] =
    mapped_column(String(50), nullable=True)`, que es lo que
    `test_drift_migraciones.py` compara contra `Base.metadata`.

El backfill NO es cosmético: sin él las 5 categorías sembradas por
`a4e7c2f9b1d8` quedarían en NULL y la API dejaría de exponer un dato que el
club ya venía publicando. Los valores son copia literal de
`app/servicios_negocio/conocimiento_club.json`, que es de donde salían hasta
ahora. Se actualiza POR `codigo` y solo donde la fila existe: la migración
no crea categorías (eso es trabajo de `a4e7c2f9b1d8`), así que una base
donde el club ya renombró o eliminó alguna de las 5 se migra igual, sin
resucitar filas ni fallar.

`String(50)` es el mismo ancho que `label`: son textos cortos de cartelera y
no hay razón para que uno admita más que el otro.

El `downgrade()` elimina la columna. Es destructivo en cuanto a datos (se
pierden las etiquetas que el admin haya editado a mano), pero no en cuanto a
categorías: ninguna fila se borra, y las 5 sembradas recuperan su etiqueta al
volver a aplicar el upgrade.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4c7e1b09a35'
down_revision: Union[str, Sequence[str], None] = 'a839entrega'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Copia literal de `conocimiento_club.json` -> `horarios[].edades`, indexada
# por el `codigo` que siembra `a4e7c2f9b1d8`.
EDADES_SEED = (
    ('FORMATIVO', '5 a 10 años'),
    ('INFANTIL', '8 a 12 años'),
    ('JUVENIL', 'Mayores de 12 años'),
    ('COMPETITIVO', 'Selección'),
    ('ADULTOS', 'Mayores de 18 años'),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'categoria_horario',
        sa.Column('edades', sa.String(length=50), nullable=True),
    )
    # Backfill de las 5 categorías sembradas. `UPDATE ... WHERE codigo = :c`
    # es un no-op silencioso si la fila no está, que es justamente lo que se
    # quiere: la migración reconcilia lo que existe, no crea categorías.
    conexion = op.get_bind()
    for codigo, edades in EDADES_SEED:
        conexion.execute(
            sa.text(
                "UPDATE categoria_horario SET edades = :edades WHERE codigo = :codigo"
            ),
            {'edades': edades, 'codigo': codigo},
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('categoria_horario', 'edades')
