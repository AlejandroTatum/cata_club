"""
Tarea Celery Beat diaria: Transición automática de Membresía ACTIVA → VENCIDA.

Regla de negocio:
    Cada noche se buscan Membresías en estado ACTIVA cuyo último Pago APROBADO
    tenga `fecha_fin < hoy` (la vigencia ya expiró). Esas membresías se marcan
    como VENCIDA — reflejo honesto del estado real que el estudiante/admin ven
    en sus pantallas, en lugar del estado "ACTIVA"_obsoleto` que el código de
    pago dejaba congelado para siempre (ver la eliminación de `cerrar_mes()`).

Justificación del modelo:
    `Membresia` no tiene `fecha_vencimiento` propio — se reusa
    `Pago.fecha_fin` como vigencia (decision de diseño compartida con
    `alertas_tareas.py`). Por eso la query se hace sobre Pago APROBADO unido a
    Membresia ACTIVA, y por cada match se hace `UPDATE Membresia SET
    estado='VENCIDA'`.

Idempotencia:
    La tarea solo toca Membresías ACTIVAS cuyo último pago aprobado ya expiró.
    Re-ejecutar el mismo día no tiene efecto extra: las Membresías que ya están
    VENCIDA no vuelven a matchear (`Membresia.estado == ACTIVA` es el filtro).
    No se reverifica si el pago fue reemplazado por uno nuevo a tiempo: la
    condición es `fecha_fin del pago aprobado más reciente < hoy`, calculada en
    runtime via SQL (no cacheada).
"""
import logging

from sqlalchemy import select, func

from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.celery_app import celery_app
from app.dominio.modelos import Membresia, Pago
from app.dominio.enums import EstadoMembresia, EstadoPago
from app.soporte_transversal.tiempo import hoy_club


logger = logging.getLogger("cataclub.tareas.vencimientos")
logger.setLevel(logging.INFO)


@celery_app.task(
    name="app.infraestructura.tareas.vencimientos_tareas.marcar_membresias_vencidas",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_max=3,
    retry_jitter=True,
)
def marcar_membresias_vencidas(self) -> dict:
    """
    Ejecución diaria: marca como VENCIDA toda Membresía ACTIVA cuyo último
    Pago APROBADO tiene fecha_fin ya vencida (anterior a la fecha de hoy).

    Returns:
        dict con resumen ejecutable: cantidad de membresías actualizadas y
        snapshot (membresia_id, persona_id, vencimiento) por cada una. Útil
        para logging y para un panel de salud del sistema.
    """
    # Día del CLUB, no del contenedor: Celery Beat ya planifica esta tarea en
    # `America/Guayaquil` (`celery_app.py::timezone`), así que calcular la
    # ventana con `date.today()` (UTC) haría que el planificador y la tarea
    # discreparan sobre qué día es. `Pago.fecha_fin` además es una fecha de
    # calendario pactada con el socio, no un instante.
    hoy = hoy_club()
    vencidas: list[dict] = []

    with SessionLocal() as db:
        # Subconsulta: para cada membresía, la fecha_fin más reciente entre
        # sus pagos APROBADOS. `func.max` sobre Pago.fecha_fin agrupado por
        # membresia_id.
        ultimo_fin = (
            select(
                Pago.membresia_id.label("membresia_id"),
                func.max(Pago.fecha_fin).label("ultima_fecha_fin"),
            )
            .where(Pago.estado_pago == EstadoPago.APROBADO)
            .group_by(Pago.membresia_id)
            .subquery()
        )

        # JOIN Membresia ACTIVA con la subconsulta del último pago aprobado;
        # si `ultima_fecha_fin < hoy` => la membresía ya expiró.
        stmt = (
            select(Membresia)
            .join(ultimo_fin, ultimo_fin.c.membresia_id == Membresia.id)
            .where(
                Membresia.estado == EstadoMembresia.ACTIVA,
                ultimo_fin.c.ultima_fecha_fin < hoy,
            )
        )
        miembros_vencidos = list(db.scalars(stmt).unique().all())

        for membresia in miembros_vencidos:
            membresia.estado = EstadoMembresia.VENCIDA
            vencidas.append({
                "membresia_id": membresia.id,
                "persona_id": membresia.persona_id,
            })

        if miembros_vencidos:
            db.commit()

    logger.info(
        "Membresías VENCIDAS el %s -> %d actualizadas",
        hoy.isoformat(),
        len(vencidas),
    )

    return {
        "fecha": hoy.isoformat(),
        "total_vencidas": len(vencidas),
        "vencidas": vencidas,
    }
