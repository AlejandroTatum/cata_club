"""
Identidad de los nombres de catálogo (descuentos, tarifas, categorías).

Dos nombres son el MISMO si coinciden tras recortar los extremos, colapsar los
espacios internos y pasar a minúsculas (`casefold`). Las tildes DISTINGUEN:
"Categoría" y "Categoria" son nombres distintos (QA3 ADM-11).
"""
from typing import Iterable


def normalizar_nombre(texto: str) -> str:
    """Valor que se guarda: sin espacios en los extremos y con los internos
    colapsados a uno solo."""
    return " ".join(texto.split())


def clave_nombre(texto: str) -> str:
    """Clave de comparación de unicidad (ver docstring del módulo)."""
    return normalizar_nombre(texto).casefold()


def existe_nombre(nombre: str, existentes: Iterable[str]) -> bool:
    clave = clave_nombre(nombre)
    return any(clave_nombre(otro) == clave for otro in existentes)
