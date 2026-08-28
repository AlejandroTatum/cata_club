"""un solo rol activo por cuenta (issue #762)

Instala la invariante "una cuenta tiene exactamente un rol activo" en
Postgres y REGISTRA -- sin tocarlas -- las cuentas que ya la violaban.

Por qué un trigger y no `UNIQUE (usuario_id)` sobre `usuario_rol`
-----------------------------------------------------------------
Un índice único sería la forma natural del invariante sobre esta tabla, y
es la primera que se probó. No sirve acá por una razón de ORDEN: Postgres
valida un índice único contra las filas EXISTENTES en el momento de
crearlo, y no admite `NOT VALID` (solo CHECK y FOREIGN KEY lo admiten). Hay
una cuenta real con dos roles en staging, así que `CREATE UNIQUE INDEX`
abortaría el `alembic upgrade` y con él el deploy entero. La única salida
sería que la migración eligiera un rol y borrara el otro -- exactamente lo
que el issue prohíbe, porque esa decisión es del dueño del club y destruye
un dato que después no se puede reconstruir.

Un trigger `BEFORE INSERT OR UPDATE` no mira las filas que ya están: solo
las nuevas. Eso es, literalmente, "detectar sin corregir": la base queda
cerrada hacia adelante, el legado sobrevive intacto, y ninguna de las dos
cosas depende de la otra. El precio es que la cuenta legada sigue en
infracción hasta que el dueño decida; a cambio, ni el deploy falla ni se
pierde información.

Por qué el trigger es seguro ante concurrencia
----------------------------------------------
Un `SELECT count(*)` a secas dentro del trigger no alcanzaría: dos
transacciones simultáneas insertando roles distintos para la misma cuenta
verían las dos "no hay otro rol" y las dos escribirían, que es el mismo
defecto que tiene el chequeo en Python. Por eso lo primero que hace la
función es tomar el lock de la fila de `usuario` (`FOR UPDATE`): la segunda
transacción se queda esperando el commit de la primera y recién entonces
cuenta, ya con una sentencia nueva y por lo tanto un snapshot nuevo bajo
READ COMMITTED. Es el mismo mecanismo que `RolRepositorio.bloquear_por_tipo`
usa para el invariante "queda al menos un administrador", con la fila de
`usuario` como mutex en vez de la del catálogo: acá el invariante es POR
CUENTA, así que la fila de la cuenta es el punto de serialización exacto.

`ERRCODE = '23505'` (unique_violation) a propósito: el error llega al
driver como una violación de unicidad, que es lo que conceptualmente es, y
el manejador global de `main.py` ya lo traduce a un 409 en vez de un 500.

Revision ID: e762rolunico
Revises: c556legal01
Create Date: 2026-08-28

"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e762rolunico"
down_revision: Union[str, Sequence[str], None] = "c556legal01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_log = logging.getLogger("alembic.runtime.migration")

NOMBRE_FUNCION = "exigir_un_solo_rol_por_usuario"
NOMBRE_TRIGGER = "trg_usuario_rol_unico_por_usuario"

SQL_FUNCION = f"""
CREATE OR REPLACE FUNCTION {NOMBRE_FUNCION}() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    rol_existente text;
BEGIN
    -- Punto de serialización: sin este lock, dos transacciones simultáneas
    -- para la misma cuenta contarían las dos sobre un estado sin roles.
    PERFORM 1 FROM usuario WHERE id = NEW.usuario_id FOR UPDATE;

    SELECT r.tipo_rol::text INTO rol_existente
      FROM usuario_rol ur
      JOIN rol r ON r.id = ur.rol_id
     WHERE ur.usuario_id = NEW.usuario_id
       AND ur.rol_id <> NEW.rol_id
     LIMIT 1;

    IF rol_existente IS NOT NULL THEN
        RAISE EXCEPTION
            'la cuenta usuario_id=% ya tiene el rol % y admite uno solo activo',
            NEW.usuario_id, rol_existente
            USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$$;
"""

# `OR UPDATE OF usuario_id, rol_id` y no solo `INSERT`: mover una fila
# existente a otra cuenta con `UPDATE` es la misma violación por otra vía, y
# un trigger de solo inserción la dejaría pasar.
SQL_TRIGGER = f"""
CREATE TRIGGER {NOMBRE_TRIGGER}
BEFORE INSERT OR UPDATE OF usuario_id, rol_id ON usuario_rol
FOR EACH ROW EXECUTE FUNCTION {NOMBRE_FUNCION}();
"""

SQL_DETECTAR_LEGADO = """
INSERT INTO rol_multiple_detectado (usuario_id, roles_detectados, cantidad_roles)
SELECT ur.usuario_id,
       string_agg(r.tipo_rol::text, ',' ORDER BY r.id),
       count(*)
  FROM usuario_rol ur
  JOIN rol r ON r.id = ur.rol_id
 GROUP BY ur.usuario_id
HAVING count(*) > 1
"""


def upgrade() -> None:
    op.create_table(
        "rol_multiple_detectado",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.Integer(), nullable=False),
        sa.Column("roles_detectados", sa.String(length=200), nullable=False),
        sa.Column("cantidad_roles", sa.Integer(), nullable=False),
        sa.Column(
            "detectado_en", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column("rol_conservado", sa.String(length=20), nullable=True),
        sa.Column("remediado_en", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    conexion = op.get_bind()
    conexion.execute(sa.text(SQL_DETECTAR_LEGADO))

    op.execute(SQL_FUNCION)
    op.execute(SQL_TRIGGER)

    _reportar_legado(conexion)


def _reportar_legado(conexion) -> None:
    """Deja el hallazgo en el log del deploy ADEMÁS de en la tabla, y nunca
    aborta.

    Las dos salidas cumplen funciones distintas y por eso están las dos: el
    log es lo que ve quien está mirando el deploy en ese momento, y la
    tabla es lo que va a poder consultar el dueño cuando decida remediar,
    semanas después, cuando ese log ya no exista.

    No se levanta ninguna excepción ni ningún `warnings.warn`: un hallazgo
    esperado no puede tumbar un deploy. Y no se registra ni un correo, ni
    una cédula, ni un nombre -- solo el id de la cuenta y los valores del
    enum, que es lo mínimo con lo que se remedia."""
    filas = conexion.execute(sa.text(
        "SELECT usuario_id, roles_detectados FROM rol_multiple_detectado "
        "WHERE remediado_en IS NULL ORDER BY usuario_id"
    )).fetchall()
    if not filas:
        return
    detalle = "; ".join(f"usuario_id={fila[0]} roles={fila[1]}" for fila in filas)
    _log.warning(
        "Issue #762: %s cuenta(s) con más de un rol activo quedaron REGISTRADAS "
        "sin modificar en `rol_multiple_detectado` (%s). La invariante ya "
        "rechaza roles nuevos sobre ellas. Elegir cuál conservar es una "
        "decisión explícita del dueño: "
        "`uv run python scripts/remediar_rol_multiple.py --usuario-id N "
        "--keep-role ROL --aplicar`.",
        len(filas), detalle,
    )


def downgrade() -> None:
    op.execute(f"DROP TRIGGER IF EXISTS {NOMBRE_TRIGGER} ON usuario_rol")
    op.execute(f"DROP FUNCTION IF EXISTS {NOMBRE_FUNCION}()")
    op.drop_table("rol_multiple_detectado")
