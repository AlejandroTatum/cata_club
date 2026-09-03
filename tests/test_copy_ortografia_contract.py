"""Candado de ortografía y registro para copy visible al usuario (issue #865).

Dos capas, con alcances deliberadamente distintos:

  · Regresión puntual: un diccionario corto (archivo, grafía prohibida, forma
    corregida) sobre los mensajes de dominio que el barrido de #865
    encontró y corrigió. No es un barrido genérico por palabra: "Categoria"
    (sin tilde) es también un identificador legítimo en todo el backend
    (la clase `CategoriaHorario`, la columna `categoria`, el repositorio
    `CategoriaRepositorio`) -- prohibir la palabra entera produciría falsos
    positivos contra el propio código fuente, así que el candado fija los
    mensajes EXACTOS que sí son copy de usuario en vez de generalizar.

  · Barrido repo-wide de `inscrpicion`: la grafía que reportó el issue no
    aparece hoy en ningún archivo versionado (código, seeds, fixtures,
    migraciones, docs, configuración). A diferencia de "Categoria", esta
    cadena nunca es un identificador legítimo ni una palabra de dominio --
    no hace falta acotar el barrido a mensajes de usuario, así que corre
    sobre CADA archivo de texto que el repositorio versiona
    (`git ls-files`), no solo sobre `backend/` o `frontend/`.

    El contenido DESPLEGADO (la base de QA) se verificó a mano al auditar
    este issue -- ver `## inscrpicion en contenido desplegado` en el PR --
    porque requiere una base de datos viva que este test, deliberadamente
    sin fixtures de Postgres, no tiene.

Para agregar un hallazgo nuevo de la primera clase: sumar una tupla a
`HALLAZGOS_CORREGIDOS` con (archivo relativo al repo, grafía prohibida,
forma corregida). El texto se lee del archivo tal cual vive en el repo, así
que la tupla sirve de test de regresión Y de inventario legible del barrido.
"""

import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]

HALLAZGOS_CORREGIDOS = [
    (
        "backend/app/servicios_negocio/asistencia_servicio.py",
        'f"Categoria {horario.categoria} no encontrada"',
        'f"Categoría {horario.categoria} no encontrada"',
    ),
    (
        "backend/app/servicios_negocio/asistencia_servicio.py",
        # Dos sitios comparten el mismo mensaje (`actualizar_categoria` y
        # `eliminar_categoria`): una sola tupla cubre ambos -- el issue pide
        # no registrar el mismo hallazgo dos veces por aparecer duplicado.
        'f"Categoria {codigo} no encontrada"',
        'f"Categoría {codigo} no encontrada"',
    ),
]


@pytest.mark.parametrize("archivo,prohibida,correcta", HALLAZGOS_CORREGIDOS)
def test_la_forma_corregida_reemplazo_a_la_grafia_prohibida(archivo, prohibida, correcta):
    texto = (RAIZ / archivo).read_text(encoding="utf-8")
    assert prohibida not in texto, f"{archivo}: sigue apareciendo «{prohibida}»"
    assert correcta in texto, f"{archivo}: falta la forma corregida «{correcta}»"


def _archivos_versionados() -> list[str]:
    resultado = subprocess.run(
        ["git", "ls-files"],
        cwd=RAIZ,
        capture_output=True,
        text=True,
        check=True,
    )
    return [linea for linea in resultado.stdout.splitlines() if linea]


def test_inscrpicion_no_aparece_en_ningun_archivo_versionado():
    ofensores = []
    for relativo in _archivos_versionados():
        ruta = RAIZ / relativo
        if not ruta.is_file():
            continue
        try:
            texto = ruta.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # binario (imagen, fuente, etc.) -- no es copy de texto
        if "inscrpicion" in texto.lower():
            ofensores.append(relativo)
    assert ofensores == [], f"grafía «inscrpicion» encontrada en: {ofensores}"
