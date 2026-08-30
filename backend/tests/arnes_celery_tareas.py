"""
Arnés compartido para inspeccionar decoradores `@celery_app.task(...)` sin
importar el módulo de tareas.

Caminar el AST en vez de importar evita dos problemas: los side effects del
import (registro de tareas, conexiones) y, sobre todo, que lo que se lea sea
lo que está ESCRITO en el decorador -- incluidas tareas que ningún test
importa -- y no lo que Celery terminó aplicando después de descartar en
silencio una opción inválida (issue #103).

Mismo criterio que `arnes_outbox.py`: acá vive solo el ANDAMIAJE de lectura.
Qué decoradores debe tener cada tarea, y qué opciones son válidas, se declara
en cada archivo de test junto al comportamiento que protege
(`test_celery_tope_de_reintentos.py`, `test_celery_config.py`).
"""
from __future__ import annotations

import ast
from pathlib import Path

_DIRECTORIO_DE_TAREAS = (
    Path(__file__).resolve().parent.parent / "app" / "infraestructura" / "tareas"
)


def archivos_de_tareas() -> list[Path]:
    """Todos los módulos `*_tareas.py`, o falla si el directorio quedó vacío
    (una ruta rota apuntaría a "ninguna tarea" en vez de avisar)."""
    archivos = sorted(_DIRECTORIO_DE_TAREAS.glob("*_tareas.py"))
    assert archivos, f"No se encontró ninguna tarea en {_DIRECTORIO_DE_TAREAS}"
    return archivos


def kwargs_de_decoradores_de_tarea(ruta: Path):
    """(nombre_de_la_funcion, linea, {kwarg: nodo}) por cada función
    decorada con `@celery_app.task(...)` en `ruta`.

    Se camina el AST y no se importa el módulo porque lo que interesa es lo
    que está ESCRITO en cada decorador, incluidas tareas que ningún test
    importa.
    """
    arbol = ast.parse(ruta.read_text(encoding="utf-8"))
    for nodo in ast.walk(arbol):
        if not isinstance(nodo, ast.FunctionDef):
            continue
        for decorador in nodo.decorator_list:
            if not isinstance(decorador, ast.Call):
                continue
            objetivo = decorador.func
            if not (
                isinstance(objetivo, ast.Attribute)
                and objetivo.attr == "task"
                and isinstance(objetivo.value, ast.Name)
                and objetivo.value.id == "celery_app"
            ):
                continue
            valores = {
                kw.arg: kw.value for kw in decorador.keywords if kw.arg is not None
            }
            yield nodo.name, decorador.lineno, valores
