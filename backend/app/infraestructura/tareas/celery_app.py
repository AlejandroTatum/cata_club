"""
Instancia central de Celery para Cata Club.

- Broker y Result Backend: Redis (configurado vía settings).
- Beat: programación diaria (cron) para las automatizaciones de dominio.
"""
from celery import Celery
from celery.schedules import crontab

from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import (
    CELERY_LIMITE_BLANDO_SEGUNDOS,
    CELERY_LIMITE_DURO_SEGUNDOS,
)

celery_app = Celery(
    "cataclub",
    broker=settings.broker_url_efectivo,
    backend=settings.result_backend_efectivo,
    include=[
        "app.infraestructura.tareas.alertas_tareas",
        "app.infraestructura.tareas.comprobante_tareas",
        "app.infraestructura.tareas.recuperacion_tareas",
        "app.infraestructura.tareas.vencimientos_tareas",
    ],
)

celery_app.conf.update(
    broker_url=settings.broker_url_efectivo,
    result_backend=settings.result_backend_efectivo,
    result_expires=settings.celery_result_expira_segundos,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=CELERY_LIMITE_BLANDO_SEGUNDOS,
    task_time_limit=CELERY_LIMITE_DURO_SEGUNDOS,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/Guayaquil",
    enable_utc=True,
)


def _parsear_hora_crontab(hhmm: str) -> crontab:
    try:
        hh, mm = hhmm.split(":")
        return crontab(hour=int(hh), minute=int(mm))
    except (ValueError, AttributeError):
        return crontab(hour=2, minute=30)


_hora_diaria = _parsear_hora_crontab(settings.celery_hora_automatizaciones)
celery_app.conf.beat_schedule = {
    "alertas-vencimiento-membresias-diaria": {
        "task": "app.infraestructura.tareas.alertas_tareas.alertar_vencimientos_hoy_mas_5",
        "schedule": _hora_diaria,
    },
    "marcar-membresias-vencidas-diaria": {
        "task": "app.infraestructura.tareas.vencimientos_tareas.marcar_membresias_vencidas",
        "schedule": _parsear_hora_crontab("02:35"),
    },
    "alertar-mora-diaria": {
        "task": "app.infraestructura.tareas.alertas_tareas.alertar_mora_diaria",
        "schedule": _parsear_hora_crontab("02:40"),
    },
    "reconciliar-comprobantes-faltantes": {
        "task": "app.infraestructura.tareas.comprobante_tareas.reconciliar_comprobantes_faltantes",
        "schedule": crontab(minute="*/15"),
    },
    "despachar-recuperaciones-pendientes": {
        "task": "app.infraestructura.tareas.recuperacion_tareas.despachar_recuperaciones_pendientes",
        "schedule": crontab(minute="*/1"),
    },
    "limpiar-recuperaciones-expiradas": {
        "task": "app.infraestructura.tareas.recuperacion_tareas.limpiar_recuperaciones_expiradas",
        "schedule": crontab(minute=5),
    },
}
