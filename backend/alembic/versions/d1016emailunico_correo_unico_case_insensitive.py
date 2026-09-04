"""correo unico case-insensitive (issue #1016, ADR-3/ADR-4)

Revision ID: d1016emailunico
Revises: 780ef12115e6
Create Date: 2026-09-04 00:00:00.000000

`ix_usuario_correo_lower` (`780ef12115e6`, issue #827) es un índice
FUNCIONAL sobre `lower(correo)` -- pero NO ÚNICO: se creó solo para
performance del `obtener_por_correo` case-insensitive. El único constraint
de unicidad real sobre `usuario.correo` sigue siendo el `unique=True`
implícito de la columna, un btree SENSIBLE A MAYÚSCULAS. Dos altas casi
simultáneas de `Juan@Gmail.com` y `juan@gmail.com` pasan las DOS el
pre-check de cada servicio (que ya busca case-insensitive, pero lee ANTES
de que la otra escriba) y las DOS logran el INSERT: `order_by(Usuario.id)`
en `obtener_por_correo` resuelve siempre a la fila más vieja, así que la
cuenta más nueva queda para siempre inalcanzable, sin ningún error visible
para nadie (issue #1016).

Esta migración, en UNA sola transacción DDL (ADR-4 -- Postgres corre DDL
transaccional; partirla en dos dejaría una ventana con filas ya
canonicalizadas pero sin la protección del índice):

  1. DETECTA colisiones preexistentes por `lower(correo)` y ABORTA sin
     aplicar nada si encuentra alguna, listando las filas. Nunca elige ni
     fusiona cuentas -- reconciliar dos cuentas de socios distintos es una
     decisión del dueño del club, no de un deploy automático. Misma
     consulta que `scripts/detectar_correos_duplicados.py`, que corre
     ANTES del deploy para dar tiempo de reconciliar a mano; esta
     migración repite el chequeo porque correr el script antes no es
     atómico con este `alembic upgrade` -- un alta puede colarse entre
     los dos.
  2. CANONICALIZA cada `correo` existente con `lower(btrim(...))`, la
     MISMA forma que `CorreoValidado` (`dtos/validadores.py`) produce de
     acá en más -- así ninguna fila legada choca contra sí misma en el
     paso 3.
  3. Reemplaza el índice funcional por uno IDÉNTICO pero ÚNICO (mismo
     nombre: no se puede `ALTER` un índice para volverlo único, hay que
     dropearlo y recrearlo).

`downgrade()`: precedente exacto `780ef12115e6`. Los valores
canonicalizados NO se revierten -- la búsqueda ya es case-insensitive, así
que siguen siendo resolubles; deshacer la canonicalización no restauraría
ningún dato que la fila no tuviera ya.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1016emailunico'
down_revision: Union[str, Sequence[str], None] = '780ef12115e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Misma consulta que `detectar_colisiones` en
# `scripts/auditar_colisiones_correo.py` (issue #902) reducida a lo que
# esta migración necesita: no hace falta la huella HMAC ni el conteo
# total, solo la clave colisionada y las filas que la componen para poder
# listarlas en el mensaje de aborto.
_SQL_COLISIONES = sa.text(
    """
    SELECT
        lower(correo) AS clave,
        array_agg(id ORDER BY id) AS ids,
        array_agg(correo ORDER BY id) AS correos
    FROM usuario
    GROUP BY lower(correo)
    HAVING count(*) > 1
    """
)


def upgrade() -> None:
    conexion = op.get_bind()

    # 1. DETECTAR / ABORTAR.
    filas = conexion.execute(_SQL_COLISIONES).fetchall()
    if filas:
        detalle = "; ".join(
            f"lower={fila.clave!r} ids={list(fila.ids)} correos={list(fila.correos)}"
            for fila in filas
        )
        raise RuntimeError(
            "Migración d1016emailunico ABORTADA: existen cuentas Usuario "
            "cuyo correo colisiona solo por capitalización o espacios. Esta "
            "migración NUNCA elige ni fusiona cuentas -- reconciliar "
            "manualmente (scripts/detectar_correos_duplicados.py da el "
            f"mismo detalle) antes de reintentar. Colisiones: {detalle}"
        )

    # 2. CANONICALIZAR. `btrim` recorta ambos extremos, igual que el
    # `.strip()` de `CorreoValidado`.
    conexion.execute(sa.text("UPDATE usuario SET correo = lower(btrim(correo))"))

    # 3. PROTEGER. El índice funcional ya existe (`780ef12115e6`) pero no
    # es único; no se puede `ALTER` un índice para volverlo único, así que
    # se dropea y se recrea con el MISMO nombre. Las tres fases corren en
    # la misma transacción DDL: si este paso fallara (inesperado tras el
    # paso 1, pero no se asume), el UPDATE del paso 2 también se revierte.
    op.drop_index("ix_usuario_correo_lower", table_name="usuario")
    op.create_index(
        "ix_usuario_correo_lower", "usuario", [sa.text("lower(correo)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_usuario_correo_lower", table_name="usuario")
    op.create_index(
        "ix_usuario_correo_lower", "usuario", [sa.text("lower(correo)")]
    )
