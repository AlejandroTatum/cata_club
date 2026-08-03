"""
Tests de configuración de límites de tiempo de Celery (`celery_app.py`).

No requieren un broker corriendo: solo inspeccionan `celery_app.conf`, que
Celery construye en memoria al importar el módulo.
"""
import inspect
import re

from app.infraestructura.tareas import celery_app as celery_app_mod
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


# --- Guardia estructural: el valor debe VENIR de la constante importada, no
# de un literal reintroducido a mano -----------------------------------------
# `celery_app.conf` se arma UNA sola vez al importar el módulo
# (`celery_app.conf.update(...)` corre en tiempo de import): un monkeypatch de
# la constante DESPUÉS de eso no puede demostrar retroactivamente que la
# config la leyó de ahí -- `celery_app.conf.task_soft_time_limit == 300`
# sería cierto tanto si viene de `CELERY_LIMITE_BLANDO_SEGUNDOS` como si
# alguien reescribiera el literal a mano en el call site. Por eso esta
# guardia inspecciona el TEXTO fuente del call site en vez del valor ya
# evaluado, mismo patrón que
# `test_limite_tasa_pagos.py::_limite_declarado`.
def _valor_de_kwarg_en_conf_update(nombre_kwarg: str) -> str:
    codigo_fuente = inspect.getsource(celery_app_mod)
    patron = re.compile(
        rf"\b{nombre_kwarg}\s*=\s*([A-Za-z_]\w*|[0-9]+(?:\.[0-9]+)?)"
    )
    coincidencia = patron.search(codigo_fuente)
    assert coincidencia, f"no se encontró '{nombre_kwarg}=' en celery_app.py"
    return coincidencia.group(1)


def test_task_soft_time_limit_referencia_la_constante_no_un_literal():
    valor = _valor_de_kwarg_en_conf_update("task_soft_time_limit")
    assert valor == "CELERY_LIMITE_BLANDO_SEGUNDOS", (
        "task_soft_time_limit debe referenciar la constante importada de "
        f"resiliencia.py, no un literal numérico; se encontró: {valor!r}"
    )


def test_task_time_limit_referencia_la_constante_no_un_literal():
    valor = _valor_de_kwarg_en_conf_update("task_time_limit")
    assert valor == "CELERY_LIMITE_DURO_SEGUNDOS", (
        "task_time_limit debe referenciar la constante importada de "
        f"resiliencia.py, no un literal numérico; se encontró: {valor!r}"
    )
