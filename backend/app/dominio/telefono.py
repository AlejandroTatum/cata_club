"""
Validación del teléfono ecuatoriano.

Decisión del usuario (PR 4b, sdd/identidad, issue #228): el club solo opera
en Ecuador, así que el dominio no admite números extranjeros ni códigos de
país. Vive junto a `cedula.py` por el mismo motivo que ese módulo: es una
regla de identidad, no una utilidad de formato, y una sola copia evita que
`app/`, `tests/` y `scripts/` terminen validando cosas distintas.

Estructura (sin separadores -- ver `es_telefono_valido`):
  - Celular: 10 dígitos, empieza en `09`.
  - Fijo: 9 dígitos, empieza en `0` (el segundo dígito es el código de
    provincia, p. ej. `02` Quito, `04` Guayaquil -- no se valida ese código
    puntual, solo el prefijo `0` y el largo).
"""

_LARGO_CELULAR = 10
_PREFIJO_CELULAR = "09"
_LARGO_FIJO = 9
_PREFIJO_FIJO = "0"


def es_telefono_valido(telefono: str) -> bool:
    """True si `telefono` son solo dígitos (ningún separador, espacio o
    letra) y calzan con un celular (10 dígitos, `09...`) o un fijo (9
    dígitos, `0...`) ecuatoriano. No normaliza ni descarta caracteres --
    quien llama decide qué hacer con un teléfono mal tipeado, este
    helper solo dice si el que llegó es válido tal cual."""
    if not telefono.isdigit():
        return False
    if len(telefono) == _LARGO_CELULAR:
        return telefono.startswith(_PREFIJO_CELULAR)
    if len(telefono) == _LARGO_FIJO:
        return telefono.startswith(_PREFIJO_FIJO)
    return False
