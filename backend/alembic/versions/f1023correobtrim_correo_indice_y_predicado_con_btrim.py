"""alinear indice y predicado de correo con btrim (issue #1023)

Revision ID: f1023correobtrim
Revises: d1016emailunico
Create Date: 2026-09-05 17:50:19.642992

`ix_usuario_correo_lower` (`d1016emailunico`, issue #1016) es único, pero
sobre `lower(correo)` -- SIN `btrim`. `UsuarioFichaRepositorio.
obtener_por_correo` recortaba el INPUT (`correo.strip().lower()`) pero
comparaba contra `lower(correo)`, la columna cruda: una fila cuyo `correo`
guardado tuviera espacios al borde quedaba agrupada como la MISMA
identidad que su gemela sin espacios (mismo `lower(btrim(...))`, la clave
que usan tanto `scripts/auditar_colisiones_correo.py` como el gate de esta
migración), pero inalcanzable por los cuatro caminos que resuelven una
cuenta por correo -- login, registro, recuperación y restablecimiento
(issue #1023).

Ese desalineamiento SOLO puede materializarse hoy vía una escritura que
bypasee `CorreoValidado` (`dtos/validadores.py`), que ya normaliza con
`strip().lower()` en cada alta/edición desde la app -- por ejemplo, un
operador reconciliando una colisión reportada por el audit que conserva a
mano la fila con espacios.

Esta migración alinea el PAR completo, no solo el predicado -- mover uno
sin el otro cambia un defecto latente por una regresión de rendimiento en
`obtener_por_correo`, la consulta más caliente del sistema (corre en cada
petición autenticada vía `GestorAutenticacion.decodificar_token` y en cada
login): un predicado sobre `lower(btrim(correo))` no puede usar un índice
declarado sobre `lower(correo)` a secas.

Mismo criterio ADR-4 que `d1016emailunico`, en UNA sola transacción DDL:

  1. DETECTA colisiones preexistentes por `lower(btrim(correo))` (la MISMA
     consulta que esa migración ya corrió) y ABORTA sin aplicar nada si
     encuentra alguna. Los datos ya deberían estar canonicalizados desde
     esa migración y desde que `CorreoValidado` normaliza en cada
     escritura de la app -- este paso solo atrapa una escritura fuera de
     banda que haya reintroducido una colisión por espacios desde
     entonces.
  2. CANONICALIZA (`UPDATE usuario SET correo = lower(btrim(correo))`),
     idempotente para las filas que ya están en forma canónica.
  3. Reemplaza el índice único por uno IDÉNTICO pero sobre
     `lower(btrim(correo))` (mismo nombre: no se puede `ALTER` la
     expresión de un índice, hay que dropearlo y recrearlo).

`downgrade()`: mismo precedente que `d1016emailunico` -- los valores
canonicalizados NO se revierten, ya son resolubles bajo cualquiera de las
dos expresiones.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1023correobtrim'
down_revision: Union[str, Sequence[str], None] = 'd1016emailunico'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Misma clave que `_CLAVE_CANONICA` de `d1016emailunico` y que
# `detectar_colisiones` en `scripts/auditar_colisiones_correo.py`: si
# difiriera, este gate quedaría más angosto que la canonicalización y una
# colisión por espacios pasaría el paso 1 para chocar recién en el
# `CREATE UNIQUE INDEX` del paso 3.
_CLAVE_CANONICA = "lower(btrim(correo))"

_SQL_COLISIONES = sa.text(
    f"""
    SELECT
        {_CLAVE_CANONICA} AS clave,
        array_agg(id ORDER BY id) AS ids,
        array_agg(correo ORDER BY id) AS correos
    FROM usuario
    GROUP BY {_CLAVE_CANONICA}
    HAVING count(*) > 1
    """
)


def upgrade() -> None:
    conexion = op.get_bind()

    # 1. DETECTAR / ABORTAR.
    filas = conexion.execute(_SQL_COLISIONES).fetchall()
    if filas:
        detalle = "; ".join(
            f"lower(btrim)={fila.clave!r} ids={list(fila.ids)} correos={list(fila.correos)}"
            for fila in filas
        )
        raise RuntimeError(
            "Migración f1023correobtrim ABORTADA: existen cuentas Usuario "
            "cuyo correo colisiona solo por espacios al borde. Esta "
            "migración NUNCA elige ni fusiona cuentas -- reconciliar "
            "manualmente (scripts/auditar_colisiones_correo.py da el "
            f"mismo detalle) antes de reintentar. Colisiones: {detalle}"
        )

    # 2. CANONICALIZAR. Idempotente: no hace nada sobre una fila que ya
    # está en forma canónica.
    conexion.execute(sa.text(f"UPDATE usuario SET correo = {_CLAVE_CANONICA}"))

    # 3. PROTEGER. No se puede `ALTER` la expresión de un índice, así que
    # se dropea y se recrea con el MISMO nombre. Las tres fases corren en
    # la misma transacción DDL: si este paso fallara, el UPDATE del paso 2
    # también se revierte.
    op.drop_index("ix_usuario_correo_lower", table_name="usuario")
    op.create_index(
        "ix_usuario_correo_lower", "usuario", [sa.text(_CLAVE_CANONICA)],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_usuario_correo_lower", table_name="usuario")
    op.create_index(
        "ix_usuario_correo_lower", "usuario", [sa.text("lower(correo)")],
        unique=True,
    )
