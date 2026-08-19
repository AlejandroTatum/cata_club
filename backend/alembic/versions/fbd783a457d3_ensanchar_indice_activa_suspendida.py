"""ensanchar uq_membresia_activa_por_persona a ACTIVA y SUSPENDIDA

Revision ID: fbd783a457d3
Revises: 798bfa9ae35e
Create Date: 2026-08-18 12:00:00.000000

Issue #400 (slice 5a): suspensión temporal.

Corrige una decisión de `d2a7e5c91b34` (la migración que agregó el estado
SUSPENDIDA). Aquella migración dejó a propósito sin tocar
`uq_membresia_activa_por_persona` (`WHERE estado = 'ACTIVA'`), documentando
que "una SUSPENDIDA tiene que poder convivir con la ACTIVA de la misma
persona". Esa premisa no se sostiene contra el propio texto del issue #400,
sección "API e invariantes": "Como máximo una membresía operativa por
persona". SUSPENDIDA no es un cuarto sabor de historial como VENCIDA/
INACTIVA -- conserva plan, beneficio, pagos y cobertura, y es candidata a
volver a ACTIVA sin pasar por una membresía nueva. Si el índice solo
protegiera ACTIVA, alguien podía suspenderse y de inmediato registrar una
membresía nueva para el mismo plan, duplicando exactamente el vínculo
persona-plan que este índice existe para impedir.

`MembresiaServicio.crear_membresia` se ensancha en el mismo commit para
rechazar también contra una SUSPENDIDA existente (chequeo Python, camino
primario de error); este índice es, como siempre, la red de seguridad ante
la carrera que ese chequeo no puede ver.

DATOS SUCIOS: mismo criterio que `c3d9f2b7a1e5` -- si la base YA tiene a
alguien con una ACTIVA y una SUSPENDIDA simultáneas (posible bajo el índice
viejo), el `DROP INDEX` + `CREATE UNIQUE INDEX` fallaría con un error de
Postgres que no dice qué filas arreglar. El pre-chequeo aborta ANTES,
nombrando la persona en conflicto, y no aplica nada (DDL transaccional).

El downgrade vuelve exactamente al predicado anterior (`estado = 'ACTIVA'`);
no hay dato que restaurar porque un índice no altera filas.
"""
from alembic import op
import sqlalchemy as sa


revision = "fbd783a457d3"
down_revision = "798bfa9ae35e"
branch_labels = None
depends_on = None


def _abortar_si_hay_duplicados(sql: str, mensaje: str) -> None:
    """Mismo helper que `c3d9f2b7a1e5._abortar_si_hay_duplicados`: no se
    importa desde ahí (los módulos de migración no se importan entre sí,
    cada uno es un snapshot congelado de su propio momento), se copia."""
    filas = op.get_bind().execute(sa.text(sql)).fetchall()
    if filas:
        detalle = ", ".join(f"id={fila[0]} ({fila[1]} filas)" for fila in filas)
        raise RuntimeError(f"{mensaje} En conflicto: {detalle}.")


def upgrade() -> None:
    _abortar_si_hay_duplicados(
        "SELECT persona_id, COUNT(*) FROM membresia "
        "WHERE estado IN ('ACTIVA', 'SUSPENDIDA') "
        "GROUP BY persona_id HAVING COUNT(*) > 1 ORDER BY persona_id",
        "No se puede ensanchar el índice único uq_membresia_activa_por_persona "
        "a ('ACTIVA', 'SUSPENDIDA'): hay personas con más de una membresía "
        "operativa (ACTIVA y/o SUSPENDIDA). Resuelva cuál queda operativa "
        "(marque las demás VENCIDA o INACTIVA) y vuelva a migrar.",
    )
    op.drop_index("uq_membresia_activa_por_persona", table_name="membresia")
    op.create_index(
        "uq_membresia_activa_por_persona",
        "membresia",
        ["persona_id"],
        unique=True,
        postgresql_where=sa.text("estado IN ('ACTIVA', 'SUSPENDIDA')"),
    )


def downgrade() -> None:
    op.drop_index("uq_membresia_activa_por_persona", table_name="membresia")
    op.create_index(
        "uq_membresia_activa_por_persona",
        "membresia",
        ["persona_id"],
        unique=True,
        postgresql_where=sa.text("estado = 'ACTIVA'"),
    )
