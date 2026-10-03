"""PERF-10: fija los intervalos del beat que deben seguir siendo de 1 minuto."""
from celery.schedules import crontab

from app.infraestructura.tareas.celery_app import celery_app

CADA_MINUTO = crontab(minute="*/1")

# Outbox de correo (REG-20) y tareas atadas a la resolución de 1 min.
PERIODICAS_DE_UN_MINUTO = (
    "despachar-inscripcion-notificaciones-cada-minuto",
    "despachar-recuperaciones-pendientes",
    "despachar-verificaciones-pendientes",
    "registrar-latido-workers-cada-minuto",
    "capturar-metricas-cada-minuto",
)


def test_el_despacho_de_correo_y_lo_atado_al_minuto_siguen_cada_minuto():
    for nombre in PERIODICAS_DE_UN_MINUTO:
        assert celery_app.conf.beat_schedule[nombre]["schedule"] == CADA_MINUTO, nombre


def test_el_resto_de_periodicas_no_corre_cada_minuto():
    for nombre, entrada in celery_app.conf.beat_schedule.items():
        if nombre not in PERIODICAS_DE_UN_MINUTO:
            assert entrada["schedule"] != CADA_MINUTO, nombre
