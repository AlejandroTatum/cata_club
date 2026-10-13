"""
Tarea Celery Beat diaria: Transición automática de Membresía ACTIVA → VENCIDA.

Regla de negocio:
    Cada noche se buscan Membresías en estado ACTIVA cuya cobertura combinada
    (último Pago APROBADO o cobertura bonificada, lo que llegue más lejos)
    tenga `fecha_fin < hoy` (la vigencia ya expiró). Esas membresías se marcan
    como VENCIDA — reflejo honesto del estado real que el estudiante/admin ven
    en sus pantallas, en lugar del estado "ACTIVA"_obsoleto` que el código de
    pago dejaba congelado para siempre (ver la eliminación de `cerrar_mes()`).

Justificación del modelo:
    `Membresia` no tiene `fecha_vencimiento` propio — se reusa
    `Pago.fecha_fin` como vigencia (decision de diseño compartida con
    `alertas_tareas.py`), junto con la cobertura bonificada (issue #1762). La
    vigencia sale de `PagoServicio.fecha_fin_maxima_combinada_bulk`; antes la
    query se hacía sobre Pago APROBADO unido a
    Membresia ACTIVA, y por cada match se hace `UPDATE Membresia SET
    estado='VENCIDA'`.

Idempotencia:
    La tarea solo toca Membresías ACTIVAS cuyo último pago aprobado ya expiró.
    Re-ejecutar el mismo día no tiene efecto extra: las Membresías que ya están
    VENCIDA no vuelven a matchear (`Membresia.estado == ACTIVA` es el filtro).
    No se reverifica si el pago fue reemplazado por uno nuevo a tiempo: la
    condición es `fecha_fin del pago aprobado más reciente < hoy`, calculada en
    runtime via SQL (no cacheada).

Reconciliación en ambas direcciones (issue #1762):
    El estado se guarda pero la cobertura se deriva de los pagos aprobados, y
    nada más levantaba una VENCIDA: un pago con fechas mal cargadas que esta
    tarea ya había vencido seguía VENCIDO aunque el admin lo corrigiera. Por eso
    la tarea también vuelve a ACTIVA una VENCIDA cuya cobertura combinada llega
    a hoy (`PagoServicio.levantar_vencida_por_cobertura`: persona activa, sin
    otra membresía operativa; sin avisos). Una por transacción: una candidata
    que se saltea no corta el lote. SUSPENDIDA e INACTIVA no se tocan.
"""
import logging
from datetime import date

from sqlalchemy import select

from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.celery_app import celery_app
from app.dominio.modelos import Membresia, Persona
from app.dominio.enums import EstadoMembresia
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from app.soporte_transversal.tiempo import hoy_club


logger = logging.getLogger("cataclub.tareas.vencimientos")
logger.setLevel(logging.INFO)


@celery_app.task(
    name="app.infraestructura.tareas.vencimientos_tareas.marcar_membresias_vencidas",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    max_retries=3,
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
    reactivadas: list[dict] = []

    with SessionLocal() as db:
        servicio = PagoServicio(db)

        # Cobertura = el MÁXIMO entre pagos aprobados y cobertura bonificada
        # (`fecha_fin_maxima_combinada_bulk`), la misma definición que usan la
        # deuda, `cubiertoHasta` y la corrección de pagos. Antes la tarea miraba
        # solo `Pago`, así que vencía membresías cubiertas por un beneficio y la
        # corrección las volvía a levantar (issue #1762). Sin cobertura alguna
        # (`None`) la membresía no se toca, igual que cuando no tenía pagos.
        def _con_cobertura(estado: EstadoMembresia) -> list[tuple[Membresia, date]]:
            membresias = list(db.scalars(
                select(Membresia)
                .join(Persona, Persona.id == Membresia.persona_id)
                .where(Membresia.estado == estado, Persona.activo.is_(True))
            ).unique().all())
            fines = servicio.fecha_fin_maxima_combinada_bulk([m.id for m in membresias])
            return [(m, fines[m.id]) for m in membresias if fines.get(m.id) is not None]

        # ACTIVA -> VENCIDA: la cobertura combinada ya terminó (`< hoy`).
        miembros_vencidos = [m for m, fin in _con_cobertura(EstadoMembresia.ACTIVA) if fin < hoy]

        for membresia in miembros_vencidos:
            membresia.estado = EstadoMembresia.VENCIDA
            vencidas.append({
                "membresia_id": membresia.id,
                "persona_id": membresia.persona_id,
            })

        if miembros_vencidos:
            db.commit()

        # VENCIDA -> ACTIVA: la misma cobertura, ahora con `>= hoy`. Se evalúa
        # DESPUÉS del paso anterior, que ya terminó (y commiteó), así que una
        # membresía no puede ir y volver en la misma corrida.
        for candidata, fin in _con_cobertura(EstadoMembresia.VENCIDA):
            if fin < hoy:
                continue
            datos = {"membresia_id": candidata.id, "persona_id": candidata.persona_id}
            if servicio.levantar_vencida_por_cobertura(candidata.id, hoy):
                reactivadas.append(datos)

    logger.info(
        "Membresías VENCIDAS el %s -> %d actualizadas, %d reactivadas",
        hoy.isoformat(),
        len(vencidas),
        len(reactivadas),
    )

    return {
        "fecha": hoy.isoformat(),
        "total_vencidas": len(vencidas),
        "vencidas": vencidas,
        "total_reactivadas": len(reactivadas),
        "reactivadas": reactivadas,
    }
