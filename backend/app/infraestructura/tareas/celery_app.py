"""
Instancia central de Celery para Cata Club.

- Broker y Result Backend: Redis (configurado vía settings).
- Beat: programación diaria (cron) para las automatizaciones de dominio.

Arquitectura: este módulo es un ADAPTADOR dentro de la capa de infraestructura.
El dominio (servicios_negocio, modelos, enums) NO importa Celery. Solo las
tareas concretas (app.infraestructura.tareas.*) se registren aquí.

Arranque:
    Worker:   celery -A app.infraestructura.tareas.celery_app worker --loglevel=info
    Beat:     celery -A app.infraestructura.tareas.celery_app beat --loglevel=info

(database_url y redis_url viven en app.soporte_transversal.configuracion.settings)
"""
from celery import Celery
from celery.schedules import crontab

from app.soporte_transversal.configuracion import settings


# --- Construcción del app de Celery -----------------------------------------
celery_app = Celery(
    "cataclub",
    broker=settings.broker_url_efectivo,
    backend=settings.result_backend_efectivo,
    include=[
        # Lista explícita de módulos con tareas registradas. Evita imports
        # circulares: celery_app importa SOLO los módulos de tareas, no los
        # servicios de dominio (esas referencias se resuelven en runtime).
        "app.infraestructura.tareas.alertas_tareas",
        "app.infraestructura.tareas.comprobante_tareas",
        "app.infraestructura.tareas.recuperacion_tareas",
        "app.infraestructura.tareas.vencimientos_tareas",
    ],
)

celery_app.conf.update(
    # --- Broker / backend ---
    broker_url=settings.broker_url_efectivo,
    result_backend=settings.result_backend_efectivo,
    result_expires=settings.celery_result_expira_segundos,

    # --- Confiabilidad ---
    task_acks_late=True,            # ack recién al terminar; los mensajes no se pierden si el worker muere.
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # fairness: no acapara tareas largas

    # --- Serialización ---
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/Guayaquil",
    enable_utc=True,

    # --- Tareas -> Beat schedule -------------------------------------------
    # Las automatizaciones diarias corren a la hora configurada (por defecto
    # 02:30). El cron usa hora LOCAL en América/Guayaquil, tal como la app
    # expone los datos al front (la `timezone` de Celery define la interpretación
    # del crontab).
)


def _parsear_hora_crontab(hhmm: str) -> crontab:
    """Convierte 'HH:MM' en un crontab diario a esa hora/minuto."""
    try:
        hh, mm = hhmm.split(":")
        return crontab(hour=int(hh), minute=int(mm))
    except (ValueError, AttributeError):
        # Fallback seguro si el .env viene mal formado.
        return crontab(hour=2, minute=30)


_hora_diaria = _parsear_hora_crontab(settings.celery_hora_automatizaciones)

celery_app.conf.beat_schedule = {
    # 1) Alertas de Vencimiento (Hoy + 5 días):
    #    Busca Pagos APROBADOS con fecha_fin == hoy + 5 y dispara alertas.
    "alertas-vencimiento-membresias-diaria": {
        "task": "app.infraestructura.tareas.alertas_tareas.alertar_vencimientos_hoy_mas_5",
        "schedule": _hora_diaria,
    },
    # 2) Marcar membresías como VENCIDAS (Hoy > fecha_fin del último pago):
    #    Transición automática de Membresia.estado ACTIVA → VENCIDA para las
    #    membresías cuyo último pago aprobado ya expiró. Corre 5 min después
    #    de la alerta (sin pisar la misma ventana horaria) para asegurar que
    #    las alertas ya emitidas no se vean afectadas por un switch previo.
    "marcar-membresias-vencidas-diaria": {
        "task": "app.infraestructura.tareas.vencimientos_tareas.marcar_membresias_vencidas",
        "schedule": _parsear_hora_crontab("02:35"),
    },
    # 3) Reconciliación de comprobantes perdidos (cada 15 minutos):
    #    Re-despacha la generación del comprobante PDF para pagos APROBADOS
    #    que siguen sin comprobante pasado el umbral (el disparo original se
    #    perdió, p. ej. Redis caído justo después del commit de la aprobación
    #    — auditoría, hallazgo 5).
    "reconciliar-comprobantes-faltantes": {
        "task": "app.infraestructura.tareas.comprobante_tareas.reconciliar_comprobantes_faltantes",
        "schedule": crontab(minute="*/15"),
    },
}


# Nota: NO usamos `autodiscover_tasks()` porque nuestros módulos de tareas
# no siguen el nombre canónico `tasks.py`. La lista explícita en `include`
# (ver arriba) es más segura y previene imports circulares.
