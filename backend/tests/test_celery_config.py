"""
Tests de configuración de Celery (`celery_app.py`): límites de tiempo y
descarte de resultados.

Casi ninguno requiere un broker corriendo: solo inspeccionan `celery_app.conf`,
que Celery construye en memoria al importar el módulo. El único que ejecuta
maquinaria de verdad —`test_una_corrida_real_no_escribe_nada_en_el_backend`—
usa un backend en memoria, no Redis.
"""
import ast
import inspect
import re
import uuid as uuid_mod

from celery.app.trace import build_tracer
from celery.backends.cache import CacheBackend

from app.infraestructura.tareas import celery_app as celery_app_mod
from app.infraestructura.tareas.celery_app import celery_app
from app.soporte_transversal.resiliencia import (
    CELERY_LIMITE_BLANDO_SEGUNDOS,
    CELERY_LIMITE_DURO_SEGUNDOS,
)
from tests.arnes_celery_tareas import archivos_de_tareas, kwargs_de_decoradores_de_tarea


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


# --- Descarte de resultados (issue #840) -------------------------------------
# Cada corrida de una tarea escribía en Redis una clave `celery-task-meta-*` con
# 24 h de TTL que NADIE lee: no hay un solo `AsyncResult`, `.ready()` ni
# `.get()` en todo el repositorio, y las cinco publicaciones descartan el
# handle. Con el beat despachando cada minuto son ~1440 objetos vivos por día
# compitiendo por los 64 MB del tope de producción
# (`docker-compose.prod.yml`) contra la cola de trabajo, que es lo único que
# ahí importa.


def test_los_resultados_de_tarea_se_descartan():
    assert celery_app.conf.task_ignore_result is True, (
        "task_ignore_result debe estar en True: sin eso cada corrida deja una "
        "clave celery-task-meta-* de 24 h en Redis que nadie consume."
    )


def test_task_ignore_result_se_declara_en_el_conf_update():
    # Misma guardia estructural que los límites de tiempo: `conf.update(...)`
    # corre en tiempo de import, así que leer el valor ya evaluado no distingue
    # "lo declara celery_app.py" de "lo puso otro módulo o un default de
    # Celery". El call site se inspecciona como texto.
    valor = _valor_de_kwarg_en_conf_update("task_ignore_result")
    assert valor == "True", (
        "task_ignore_result debe declararse explícitamente en el conf.update "
        f"de celery_app.py; se encontró: {valor!r}"
    )


def test_una_corrida_real_no_escribe_nada_en_el_backend():
    """El único que mide el ahorro en vez de repetir la config.

    Los dos anteriores solo afirman que el flag está puesto; ninguno prueba
    que Celery deje de ESCRIBIR. La escritura ocurre en el tracer del worker
    (`celery.app.trace`), no en `.delay()` ni en el modo eager —el eager ni
    siquiera almacena, porque `store_eager_result` es False por defecto, así
    que un test eager pasaría en verde con o sin el arreglo—. Por eso se
    construye el tracer real con `eager=False` y se le cuelga a la tarea un
    backend de verdad en memoria (`cache+memory://`), que guarda las claves en
    un diccionario en vez de en Redis. Lo que se afirma es lo mismo que se
    quiere en producción: después de correr la tarea no apareció ninguna clave
    nueva en el backend.
    """
    espia = CacheBackend(app=celery_app, backend="memory")

    @celery_app.task(name="tests.celery_config.tarea_de_sonda_840")
    def tarea_de_sonda():
        return {"ok": True}

    tarea = celery_app.tasks["tests.celery_config.tarea_de_sonda_840"]
    tarea.backend = espia

    # El diccionario de `DummyClient` es un global compartido del proceso: se
    # mide el DELTA, no el total, para no depender de qué corrió antes.
    claves_previas = set(espia.client.cache)

    identificador = str(uuid_mod.uuid4())
    tracer = build_tracer(
        tarea.name, tarea, app=celery_app, eager=False, propagate=True
    )
    resultado = tracer(identificador, (), {}, {})

    assert resultado.info is None, (
        f"la tarea de sonda no debía fallar: {resultado.retval!r}"
    )

    claves_nuevas = set(espia.client.cache) - claves_previas
    assert not claves_nuevas, (
        "correr una tarea dejó resultados en el backend: "
        f"{sorted(k.decode() if isinstance(k, bytes) else k for k in claves_nuevas)}. "
        "Nadie los lee y ocupan memoria en Redis durante result_expires."
    )


def test_ninguna_tarea_reactiva_su_resultado_por_su_cuenta():
    """`ignore_result=False` en un decorador vuelve a escribir en Redis para
    esa tarea. Es una salida de emergencia legítima —por eso se conserva el
    backend configurado—, pero tiene que costar un diff visible y no colarse
    de a una. Hoy no hay ninguna, y este candado obliga a que agregarla sea
    deliberado.

    El recorrido del AST (`kwargs_de_decoradores_de_tarea`) es el mismo que
    usa `test_celery_tope_de_reintentos.py` -- vive en
    `tests/arnes_celery_tareas.py` para no repetirlo con otro nombre de
    variable.
    """
    reactivadas = []

    for ruta in archivos_de_tareas():
        for nombre, linea, valores in kwargs_de_decoradores_de_tarea(ruta):
            nodo_valor = valores.get("ignore_result")
            if isinstance(nodo_valor, ast.Constant) and nodo_valor.value is False:
                reactivadas.append(f"{ruta.name}:{linea} {nombre}()")

    assert not reactivadas, (
        "Tareas que vuelven a guardar su resultado en Redis "
        f"({len(reactivadas)}):\n  " + "\n  ".join(reactivadas) + "\n"
        "Si hace falta, se agrega acá con el motivo por el que ALGUIEN lo lee."
    )
