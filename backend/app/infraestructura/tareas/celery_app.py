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
        "app.infraestructura.tareas.verificacion_correo_tareas",
        "app.infraestructura.tareas.enrollment_notificacion_tareas",
        "app.infraestructura.tareas.vencimientos_tareas",
    ],
)

celery_app.conf.update(
    broker_url=settings.broker_url_efectivo,
    result_backend=settings.result_backend_efectivo,
    result_expires=settings.celery_result_expira_segundos,
    # Issue #840. Nadie lee los resultados: no hay un solo `AsyncResult`,
    # `.ready()` ni `.get()` en el repositorio, y las cinco publicaciones
    # descartan el handle. Aun así cada corrida dejaba en Redis una clave
    # `celery-task-meta-*` viva 24 h; con el beat despachando cada minuto son
    # ~1440 objetos por día disputándole memoria a la cola de trabajo dentro
    # del tope de 64 MB de producción (`docker-compose.prod.yml`), que es lo
    # único que ahí hace falta guardar. Con esto Celery ni siquiera las
    # escribe, y como `task_store_errors_even_if_ignored` es False por
    # defecto, tampoco guarda los fallos.
    #
    # El backend SIGUE configurado a propósito, y no es un descuido: es lo que
    # deja abierta la salida de emergencia de poner `ignore_result=False` en
    # una tarea puntual el día que alguien de verdad necesite leer su
    # resultado — sin backend ese kwarg no tiene dónde escribir. Por lo mismo
    # `result_expires` de arriba NO es código muerto: hoy gobierna un conjunto
    # vacío, pero sigue siendo el TTL que le aplicaría a cualquier tarea que
    # se reactive así.
    task_ignore_result=True,
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
    "despachar-inscripcion-notificaciones-cada-minuto": {
        "task": "app.infraestructura.tareas.enrollment_notificacion_tareas.despachar_inscripcion_notificaciones",
        "schedule": crontab(minute="*/1"),
    },
    "limpiar-inscripcion-notificaciones-diaria": {
        "task": "app.infraestructura.tareas.enrollment_notificacion_tareas.limpiar_inscripcion_notificaciones",
        "schedule": _hora_diaria,
    },
    # 1) Alertas de Vencimiento (Hoy + 5 días):
    #    Busca Pagos APROBADOS con fecha_fin == hoy + 5 y dispara alertas.
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
    # Issue #790. Mismo ritmo que la recuperación: quien acaba de inscribirse
    # en el club está mirando la pantalla, y un enlace que tarda más de un
    # minuto en salir se vive como que no llegó.
    "despachar-verificaciones-pendientes": {
        "task": "app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes",
        "schedule": crontab(minute="*/1"),
    },
    "limpiar-verificaciones-expiradas": {
        "task": "app.infraestructura.tareas.verificacion_correo_tareas.limpiar_verificaciones_expiradas",
        "schedule": crontab(minute=10),
    },
}
