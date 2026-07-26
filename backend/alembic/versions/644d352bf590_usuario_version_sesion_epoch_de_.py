"""usuario version_sesion epoch de invalidacion de sesion

Revision ID: 644d352bf590
Revises: a1b2c3d4e5f6
Create Date: 2026-07-26 10:26:15.493121

Agrega `usuario.version_sesion`: epoch monotónico para invalidar sesiones
emitidas ("cerrar mis otras sesiones"), siguiendo el mismo patrón que
`version_contrasenia` pero en un dominio de invalidación independiente.

`server_default='1'` es intencional (a diferencia de `version_contrasenia`,
que solo tiene default de Python): agregar una columna NOT NULL a una tabla
con filas existentes requiere un default a nivel de servidor en PostgreSQL,
y además protege contra un INSERT crudo que salte el ORM.

Nota: `alembic revision --autogenerate` también detectó drift preexistente
no relacionado con este cambio (constraint `uq_alumno_horario` y columna
`ranking.ultimo_combate_o_asistencia`, ausentes del modelo actual). Se
excluye deliberadamente de esta migración -- igual criterio que D4: un
fix quirúrgico no debe arrastrar cambios no relacionados. Ese drift queda
fuera de alcance de este slice.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '644d352bf590'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('usuario', schema=None) as batch_op:
        batch_op.add_column(sa.Column('version_sesion', sa.Integer(), server_default='1', nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('usuario', schema=None) as batch_op:
        batch_op.drop_column('version_sesion')
