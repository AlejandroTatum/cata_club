"""Rotación del refresh y vigencia por sesión (issue #1653).

Revision ID: y1653sesionrotacion
Revises: x1709diasinclased1

Aditiva y compatible hacia atrás: cinco columnas NULLABLE en `sesion`
(`refresh_jti`, `refresh_jti_anterior`, `rotado_en`, `ultimo_uso_en`,
`revocada_en`). Sin backfill: una fila con `refresh_jti` nulo es una sesión
anterior al despliegue, y su refresh sin `jti` se acepta una vez y se migra al
esquema nuevo (S3). El código anterior ignora las columnas.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "y1653sesionrotacion"
down_revision: Union[str, Sequence[str], None] = "x1709diasinclased1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sesion", sa.Column("refresh_jti", sa.String(length=32), nullable=True))
    op.add_column("sesion", sa.Column("refresh_jti_anterior", sa.String(length=32), nullable=True))
    op.add_column("sesion", sa.Column("rotado_en", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sesion", sa.Column("ultimo_uso_en", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sesion", sa.Column("revocada_en", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("sesion", "revocada_en")
    op.drop_column("sesion", "ultimo_uso_en")
    op.drop_column("sesion", "rotado_en")
    op.drop_column("sesion", "refresh_jti_anterior")
    op.drop_column("sesion", "refresh_jti")
