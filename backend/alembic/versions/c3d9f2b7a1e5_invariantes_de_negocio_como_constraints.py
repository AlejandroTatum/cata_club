"""invariantes de negocio como constraints

Revision ID: c3d9f2b7a1e5
Revises: e1b7c40d2f95
Create Date: 2026-07-30 00:00:00.000000

Lleva a la BASE dos invariantes que hasta ahora solo protegía el patrón
leer-luego-escribir de los servicios (auditoría hallazgo 7, issue #8) -- dos
peticiones concurrentes podían pasar las dos el chequeo y violarlos:

  - `uq_pago_pendiente_por_membresia`: índice único PARCIAL sobre
    `pago (membresia_id) WHERE estado_pago = 'PENDIENTE_VALIDACION'`.
    Un solo pago pendiente por membresía; el historial APROBADO/RECHAZADO
    no queda limitado. Espejo exacto del chequeo de
    `PagoRepositorio.existe_pendiente_para_membresia`.

  - `uq_membresia_activa_por_persona`: índice único PARCIAL sobre
    `membresia (persona_id) WHERE estado = 'ACTIVA'`.
    Una sola membresía activa por persona; el historial VENCIDA/INACTIVA
    convive sin límite. Espejo exacto del chequeo de
    `MembresiaServicio.crear_membresia` (`estado == ACTIVA`).

Los otros dos invariantes del mismo hallazgo (capacidad máxima de nivel y
último administrador activo) tienen forma de CONTEO, no de unicidad, y se
serializan con `SELECT ... FOR UPDATE` en los servicios -- no requieren
cambio de esquema (ver `ranking_servicio.py` y `rol_servicio.py`).

DATOS SUCIOS: si la base YA viola un invariante, esta migración falla
RUIDOSAMENTE con las filas en conflicto y la instrucción de resolverlas, y
no aplica nada (DDL transaccional). NO deduplica sola: decidir cuál pago se
aprueba/rechaza o cuál membresía sigue activa es una decisión de negocio que
una migración no debe adivinar. No existe en el repo ninguna migración
previa que deduplique datos; este criterio de "fallar con instrucciones" es
el que se fija aquí. Sin el pre-chequeo, `CREATE UNIQUE INDEX` fallaría de
todos modos, pero con un error de Postgres que no dice QUÉ filas arreglar.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3d9f2b7a1e5'
down_revision: Union[str, Sequence[str], None] = 'e1b7c40d2f95'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _abortar_si_hay_duplicados(sql: str, mensaje: str) -> None:
    """Pre-chequeo accionable: si `sql` devuelve filas, la base ya viola el
    invariante y se aborta ANTES del `CREATE UNIQUE INDEX`, nombrando las
    filas en conflicto para que el operador sepa exactamente qué resolver."""
    filas = op.get_bind().execute(sa.text(sql)).fetchall()
    if filas:
        detalle = ", ".join(f"id={fila[0]} ({fila[1]} filas)" for fila in filas)
        raise RuntimeError(f"{mensaje} En conflicto: {detalle}.")


def upgrade() -> None:
    """Upgrade schema."""
    _abortar_si_hay_duplicados(
        "SELECT membresia_id, COUNT(*) FROM pago "
        "WHERE estado_pago = 'PENDIENTE_VALIDACION' "
        "GROUP BY membresia_id HAVING COUNT(*) > 1 ORDER BY membresia_id",
        "No se puede crear el índice único uq_pago_pendiente_por_membresia: "
        "hay membresías con más de un pago PENDIENTE_VALIDACION. Apruebe o "
        "rechace los pagos pendientes duplicados de cada membresía y vuelva "
        "a migrar.",
    )
    _abortar_si_hay_duplicados(
        "SELECT persona_id, COUNT(*) FROM membresia "
        "WHERE estado = 'ACTIVA' "
        "GROUP BY persona_id HAVING COUNT(*) > 1 ORDER BY persona_id",
        "No se puede crear el índice único uq_membresia_activa_por_persona: "
        "hay personas con más de una membresía ACTIVA. Deje una sola activa "
        "por persona (marque las demás VENCIDA o INACTIVA) y vuelva a migrar.",
    )
    op.create_index(
        "uq_pago_pendiente_por_membresia",
        "pago",
        ["membresia_id"],
        unique=True,
        postgresql_where=sa.text("estado_pago = 'PENDIENTE_VALIDACION'"),
    )
    op.create_index(
        "uq_membresia_activa_por_persona",
        "membresia",
        ["persona_id"],
        unique=True,
        postgresql_where=sa.text("estado = 'ACTIVA'"),
    )


def downgrade() -> None:
    """Downgrade schema. Quita los índices; no hay datos que restaurar (los
    índices no alteran filas), así que la vuelta es completa y honesta."""
    op.drop_index("uq_membresia_activa_por_persona", table_name="membresia")
    op.drop_index("uq_pago_pendiente_por_membresia", table_name="pago")
