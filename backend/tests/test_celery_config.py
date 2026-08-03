"""
Tests de configuración de límites de tiempo de Celery (`celery_app.py`).

No requieren un broker corriendo: solo inspeccionan `celery_app.conf`, que
Celery construye en memoria al importar el módulo.
"""
from app.infraestructura.tareas.celery_app import celery_app
from app.soporte_transversal.resiliencia import (
    CELERY_LIMITE_BLANDO_SEGUNDOS,
    CELERY_LIMITE_DURO_SEGUNDOS,
)


def test_limites_de_tiempo_vienen_de_resiliencia_py():
    assert celery_app.conf.task_soft_time_limit == CELERY_LIMITE_BLANDO_SEGUNDOS
    assert celery_app.conf.task_time_limit == CELERY_LIMITE_DURO_SEGUNDOS


def test_el_limite_duro_es_estrictamente_mayor_al_blando():
    # Ventana de limpieza: tiempo para que `SoftTimeLimitExceeded` desenrolle
    # el `with SessionLocal()` y `autoretry_for` programe el reintento antes
    # del SIGKILL del límite duro.
    assert celery_app.conf.task_time_limit > celery_app.conf.task_soft_time_limit


def test_el_limite_duro_queda_bajo_el_intervalo_del_beat_mas_corto():
    # `reconciliar-comprobantes-faltantes` corre cada 15 minutos (900s,
    # `celery_app.py`). Un límite duro por encima de eso dejaría que una
    # corrida trabada se solape con su propia sucesora.
    intervalo_beat_mas_corto_segundos = 900
    assert celery_app.conf.task_time_limit < intervalo_beat_mas_corto_segundos
