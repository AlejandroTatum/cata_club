"""indice funcional sobre usuario.correo en minuscula

Revision ID: 780ef12115e6
Revises: d4c7e1b09a35
Create Date: 2026-09-02 00:00:00.000000

Issue #827, complemento de #811: `UsuarioRepositorio.obtener_por_correo`
filtra por `func.lower(Usuario.correo) == correo.strip().lower()`, no por
`correo`. El único índice existente sobre la columna es el unique implícito,
un btree sensible a mayúsculas que no puede servir ese predicado -- y esa
consulta corre en CADA petición autenticada (`GestorAutenticacion.
decodificar_token`, detrás de unas 55 `Depends(...)`) y en cada
`POST /auth/login`, así que el recorrido secuencial es sobre el camino más
caliente del sistema.

`ix_usuario_correo_lower` es un índice FUNCIONAL sobre `lower(correo)`, la
misma expresión del filtro. Declarado en el `__table_args__` de `Usuario`
(`app/dominio/modelos.py`) y verificado contra el catálogo real de Postgres
en `tests/test_indices_consultas_reales.py`.

Como en `d4f8c2a6b0e3` (#811), se usa `op.create_index`/`op.drop_index`
PLANO, sin `CONCURRENTLY`: al volumen actual el costo de un `ACCESS
EXCLUSIVE` breve es insignificante frente al riesgo de un build fallido que
queda `INVALID` sin rollback atómico.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '780ef12115e6'
down_revision: Union[str, Sequence[str], None] = 'd4c7e1b09a35'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_usuario_correo_lower", "usuario", [sa.text("lower(correo)")]
    )


def downgrade() -> None:
    op.drop_index("ix_usuario_correo_lower", table_name="usuario")
