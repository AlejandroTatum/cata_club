"""
Candado del tope de reintentos de las tareas Celery (issue #103).

Dos niveles, a propósito:

1. `test_cada_tarea_aplica_el_tope_de_reintentos_que_declara` mide el tope
   EFECTIVO leyéndolo de la tarea ya construida. Es lo único que distingue
   "pedimos 5" de "obtenemos 5".

2. `test_ningun_decorador_usa_una_opcion_que_celery_ignora` es el que hace
   permanente el arreglo. La causa raíz del #103 no fue un número mal puesto:
   fue que `retry_max` **no es una opción válida** y Celery la descarta SIN
   warning, así que el decorador se leía perfecto y no hacía nada. Cuatro de
   los cinco sitios "funcionaban" por coincidencia, porque pedían 3 y 3 es el
   default. Un test que solo mirara los números habría pasado en verde sobre
   el bug.

El tope se declara con `max_retries=N`, que es un atributo real de `Task`, y
NO con `retry_kwargs={"max_retries": N}`. Las dos formas gobiernan el
autorreintento — `add_autoretry_behaviour` termina en
`task.retry(exc=exc, **retry_kwargs)` — pero `retry_kwargs` deja
`task.max_retries` en su default de 3, así que el atributo diría 3 mientras el
tope real es otro. Reintroduciría, en otra forma, exactamente el problema que
este candado existe para impedir: declarar una cosa y hacer otra.
"""
import pytest
from celery.app.task import Task

from app.infraestructura.tareas.alertas_tareas import alertar_vencimientos_hoy_mas_5
from app.infraestructura.tareas.comprobante_tareas import (
    generar_comprobante_pdf_tarea,
    reconciliar_comprobantes_faltantes,
)
from app.infraestructura.tareas.vencimientos_tareas import marcar_membresias_vencidas
from tests.arnes_celery_tareas import archivos_de_tareas, kwargs_de_decoradores_de_tarea

# Tope declarado por cada tarea. `generar_comprobante_pdf_tarea` es la única
# que pide más que el default: es la que sube el PDF a Cloudinary, o sea la que
# más se beneficia del margen extra — y era justamente la única cuyo
# comportamiento real difería de lo que declaraba.
_TOPE_ESPERADO = [
    (generar_comprobante_pdf_tarea, 5),
    (reconciliar_comprobantes_faltantes, 3),
    (alertar_vencimientos_hoy_mas_5, 3),
    (marcar_membresias_vencidas, 3),
]

# Opciones de autorreintento que Celery lee de verdad, según
# `celery.app.autoretry.add_autoretry_behaviour`. NO incluye `retry_max`, que
# es exactamente el punto del issue #103.
_OPCIONES_DE_AUTORETRY = frozenset(
    {
        "autoretry_for",
        "dont_autoretry_for",
        "retry_kwargs",
        "retry_backoff",
        "retry_backoff_max",
        "retry_jitter",
    }
)

# Opciones que consume el DECORADOR y que por eso no son atributos de `Task`.
_OPCIONES_DEL_DECORADOR = frozenset({"bind", "base", "name", "shared", "typing", "filter"})


def _opciones_validas() -> frozenset[str]:
    """Todo lo que Celery realmente interpreta: los atributos de `Task`, más
    las opciones del decorador, más las de autorreintento."""
    return frozenset(dir(Task)) | _OPCIONES_DEL_DECORADOR | _OPCIONES_DE_AUTORETRY


@pytest.mark.parametrize(
    "tarea, tope",
    _TOPE_ESPERADO,
    ids=[t.__name__ for t, _ in _TOPE_ESPERADO],
)
def test_cada_tarea_aplica_el_tope_de_reintentos_que_declara(tarea, tope):
    """El tope EFECTIVO, leído de la tarea construida — no el kwarg escrito."""
    assert tarea.max_retries == tope, (
        f"{tarea.name} aplica max_retries={tarea.max_retries} pero se esperaba "
        f"{tope}. El tope se declara con `max_retries=N` en el decorador. Si se "
        f"usa un kwarg que Celery no lee, se descarta en silencio y rige el "
        f"default de 3."
    )


def test_ningun_decorador_usa_una_opcion_que_celery_ignora():
    """Ninguna opción de `@celery_app.task(...)` puede ser una que Celery
    descarte. Sin excepciones: una opción no reconocida no falla, no avisa, y
    deja el decorador diciendo una cosa y haciendo otra."""
    validas = _opciones_validas()
    violaciones = []

    for ruta in archivos_de_tareas():
        for nombre, linea, valores in kwargs_de_decoradores_de_tarea(ruta):
            for clave in sorted(valores.keys() - validas):
                violaciones.append(f"{ruta.name}:{linea} {nombre}() -> {clave}")

    assert not violaciones, (
        "Opciones que Celery IGNORA en silencio "
        f"({len(violaciones)}):\n  " + "\n  ".join(violaciones)
    )
