"""Retención del contador diario de envíos SMTP.

`contador_correo_diario` es estado operativo puro: una fila por día que solo
existe para que la API y el worker Celery compartan, de forma atómica, cuántos
cupos del proveedor ya se reservaron HOY (ver
`notificaciones_servicio._reservar_cupo_de_envio_diario`). Pasado ese día, la
fila no cuenta ninguna historia que el club necesite: no identifica a nadie
-- ni destinatario, ni asunto, ni operación -- y el rastro auditable de cada
entrega vive en la cola de salida que la originó (`Notificacion.
last_error_redacted`, las tablas de outbox). Por eso se conserva una ventana
amplia y después se borra, en vez de acumular para siempre una fila diaria.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete

from app.dominio.modelos import ContadorCorreoDiario
from app.infraestructura.db import SessionLocal
from app.infraestructura.tareas.celery_app import celery_app

logger = logging.getLogger("cataclub.tareas.contador_correo")


# Días de historia que se conservan. El número no es una regla de negocio:
# es cuánto hace falta para diagnosticar "aquel mes se agotó el cupo todos los
# días" sin guardar indefinidamente un contador que no identifica nada. Se
# borran las fechas ANTERIORES a `hoy - DIAS_RETENCION`; la fecha límite
# exacta se conserva, así que la ventana real es de 91 fechas (la de hoy y las
# 90 anteriores).
DIAS_RETENCION_CONTADOR_CORREO = 90


@celery_app.task(
    name="app.infraestructura.tareas.contador_correo_tareas.limpiar_contador_correo_diario",
)
def limpiar_contador_correo_diario() -> dict:
    """Borra las filas del contador anteriores a la ventana de retención.

    Idempotente por construcción: el predicado es una comparación de fechas
    contra `hoy - DIAS_RETENCION_CONTADOR_CORREO`, así que una segunda corrida
    el mismo día no encuentra nada que borrar.

    El corte se calcula con el reloj de las PROPIAS filas -- `fecha` se escribe
    como día UTC (`datetime.now(timezone.utc).date()` en
    `_reservar_cupo_de_envio_diario`, decisión de aquel guardarraíl, no de
    esta tarea) -- no con `hoy_club()`. Mezclar acá el día del club correría
    el corte hasta cinco horas y borraría una fecha que el contador todavía
    considera suya.
    """
    fecha_limite = datetime.now(timezone.utc).date() - timedelta(
        days=DIAS_RETENCION_CONTADOR_CORREO
    )
    with SessionLocal() as db:
        resultado = db.execute(
            delete(ContadorCorreoDiario).where(ContadorCorreoDiario.fecha < fecha_limite)
        )
        db.commit()
    logger.info(
        "Retención del contador de correos: %s fila(s) anteriores a %s eliminadas",
        resultado.rowcount, fecha_limite.isoformat(),
    )
    return {"fecha_limite": fecha_limite.isoformat(), "eliminadas": resultado.rowcount}
