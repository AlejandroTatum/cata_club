"""PERF-10: fija los intervalos del beat.

El latido y las métricas siguen cada minuto; los tres barridos del outbox
(REG-20) son ahora respaldo del despacho al commit y corren cada 5 minutos.
Ninguna otra periódica puede correr cada minuto.
"""
from celery.schedules import crontab

from app.infraestructura.tareas.celery_app import celery_app

CADA_MINUTO = crontab(minute="*/1")
CADA_5_MINUTOS = crontab(minute="*/5")

CADA_MINUTO_POR_CONTRATO = (
    "registrar-latido-workers-cada-minuto",
    "capturar-metricas-cada-minuto",
)
BARRIDOS_DEL_OUTBOX = (
    "despachar-inscripcion-notificaciones-cada-5-minutos",
    "despachar-recuperaciones-pendientes",
    "despachar-verificaciones-pendientes",
)


def test_latido_y_metricas_siguen_cada_minuto():
    for nombre in CADA_MINUTO_POR_CONTRATO:
        assert celery_app.conf.beat_schedule[nombre]["schedule"] == CADA_MINUTO, nombre


def test_los_barridos_del_outbox_corren_cada_5_minutos():
    for nombre in BARRIDOS_DEL_OUTBOX:
        assert celery_app.conf.beat_schedule[nombre]["schedule"] == CADA_5_MINUTOS, nombre


def test_ninguna_otra_periodica_corre_cada_minuto():
    for nombre, entrada in celery_app.conf.beat_schedule.items():
        if nombre not in CADA_MINUTO_POR_CONTRATO:
            assert entrada["schedule"] != CADA_MINUTO, nombre
