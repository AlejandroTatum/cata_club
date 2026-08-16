"""crear tabla sesion

Revision ID: c4f8a2e7b013
Revises: b7c2e4a9f1d3
Create Date: 2026-08-16 00:00:00.000000

Registro observacional de logins, para el historial de sesiones que
`/profile` muestra al dueño de la cuenta.

NO toca el mecanismo de invalidación. `usuario.version_sesion` -- el epoch
que viaja en el claim `sver` -- sigue siendo lo único que decide si un token
vale (ver `GestorAutenticacion.epoch_valido`). Esta tabla solo observa, y por
eso guarda el epoch vigente al abrirse cada sesión: una fila cuyo
`version_sesion` quedó por debajo del de su usuario está muerta, y eso se
deriva del mecanismo autoritativo en vez de duplicarlo.

Sin columna de IP a propósito: es dato personal, el club maneja cuentas de
menores y de sus representantes, y ningún caso de uso la lee. Lo que se
guarda es una etiqueta de dispositivo ya derivada del user-agent
(`soporte_transversal/dispositivo.py`), acotada a 80 caracteres.

Sin `ultimo_uso_en`: actualizarlo exigiría que el refresh supiera a qué fila
corresponde, y el token no lleva identificador de sesión. Una columna que
nunca se actualiza es una mentira con forma de dato, así que no se crea hasta
que se pueda sostener.

`ondelete="CASCADE"` sobre `usuario_id`: borrar un usuario debe llevarse su
historial de sesiones: no queda nadie a quien mostrárselo, y el borrado duro
de `Usuario` ya existe en el producto.

Downgrade: elimina el índice y la tabla, dejando el esquema idéntico al
estado previo. No hay datos que preservar -- la tabla nace vacía y su
contenido es reconstruible con el próximo login de cada usuario.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c4f8a2e7b013'
down_revision: Union[str, Sequence[str], None] = 'b7c2e4a9f1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sesion",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.Integer(), nullable=False),
        sa.Column("dispositivo", sa.String(length=80), nullable=False),
        sa.Column("iniciada_en", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version_sesion", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["usuario_id"], ["usuario.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # La consulta real es siempre "las sesiones de este usuario, la más
    # reciente primero", así que el índice cubre las dos mitades. Cubre además
    # la FK, que es lo que `faaadef2afa8` dejó como criterio del proyecto.
    op.create_index(
        "ix_sesion_usuario_iniciada", "sesion", ["usuario_id", "iniciada_en"], unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_sesion_usuario_iniciada", table_name="sesion")
    op.drop_table("sesion")
