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

Issue #855: un navegador móvil autocompleta el celular en formato
internacional (`+593991234567`, `593991234567`). `es_telefono_valido` sigue
sin aceptarlos -- sigue siendo "¿esto que llegó es un teléfono ecuatoriano
válido tal cual?" -- pero `normalizar_telefono` convierte ese formato al
local ANTES de esa pregunta, para que quien llama (`validadores.py`) pueda
aceptar los tres formatos y seguir almacenando uno solo.
"""

import re
from typing import Optional

_LARGO_CELULAR = 10
_PREFIJO_CELULAR = "09"
_LARGO_FIJO = 9
_PREFIJO_FIJO = "0"

# País (`593`) + troncal de celular (`9`) + 8 dígitos del abonado. El `+` es
# opcional -- el navegador autocompleta con y sin él -- y la coincidencia
# tiene que ser exacta: un fijo o un celular que ya está en formato local no
# calzan y `normalizar_telefono` los deja tal cual.
_PATRON_CELULAR_INTERNACIONAL = re.compile(r"^\+?593(9\d{8})$")


def normalizar_telefono(telefono: str) -> str:
    """Convierte un celular en formato internacional (`+593…`/`593…`) a su
    forma local `09XXXXXXXX`. No toca separadores -- este módulo nunca los
    aceptó, ni antes de esta función ni después (`test_separadores_se_
    rechazan_no_se_descartan`) -- así que solo opera sobre la secuencia de
    dígitos (más el `+` opcional) que ya llegó sin ellos. Un fijo, un celular
    que ya está en formato local, o cualquier otra cosa se devuelve TAL
    CUAL, sin normalizar."""
    coincidencia = _PATRON_CELULAR_INTERNACIONAL.match(telefono)
    return f"0{coincidencia.group(1)}" if coincidencia else telefono


def es_telefono_valido(telefono: str) -> bool:
    """True si `telefono` son solo dígitos (ningún separador, espacio o
    letra) y calzan con un celular (10 dígitos, `09...`) o un fijo (9
    dígitos, `0...`) ecuatoriano. No normaliza ni descarta caracteres --
    quien llama decide qué hacer con un teléfono mal tipeado, este
    helper solo dice si el que llegó es válido tal cual."""
    # `isascii()` antes de `isdigit()`: `str.isdigit()` sola acepta dígitos
    # no ASCII (arábigo-índicos `٠١٢`, devanagari, con volado...), y el
    # `[0-9]` del CHECK de la base NO los acepta. Sin este filtro, un
    # `'09' + '٢'*8` pasaba esta capa y estallaba recién en el flush como
    # `IntegrityError`, en vez de salir como un `ValueError` limpio. Las dos
    # capas tienen que coincidir en qué es un dígito.
    if not (telefono.isascii() and telefono.isdigit()):
        return False
    if len(telefono) == _LARGO_CELULAR:
        return telefono.startswith(_PREFIJO_CELULAR)
    if len(telefono) == _LARGO_FIJO:
        return telefono.startswith(_PREFIJO_FIJO)
    return False


# Issue #860: un contacto de emergencia deja de cumplir su función si es el
# mismo número que el personal del titular -- deja de ser una vía alternativa
# para cuando esa persona no puede responder. El mensaje vive acá, junto a la
# comparación, y lo reusan tanto los DTOs (`validadores.py`, vía
# `ValueError`) como el servicio de ficha médica (vía `OperacionInvalida`),
# para que el 422 de un DTO y el 400 de un bypass digan exactamente lo mismo.
MENSAJE_TELEFONO_EMERGENCIA_IGUAL = (
    "El teléfono de emergencia debe ser diferente del teléfono del estudiante."
)


def telefonos_coinciden(a: Optional[str], b: Optional[str]) -> bool:
    """True si `a` y `b` son el MISMO teléfono ecuatoriano, comparados ya
    normalizados: `0993568597`, `+593993568597` y `593993568597` cuentan
    como el mismo número (issue #855, reusado acá para el #860).

    Si cualquiera de los dos está ausente (`None` o `""`) no hay
    coincidencia -- el teléfono personal es opcional en algunos caminos
    (ver `Persona.telefono` con `""`, documentado en `_exigir_telefono_
    valido` de `modelos.py`), y esta comparación nunca vuelve obligatorio
    un campo que no lo es: solo compara dos valores que YA existen."""
    if not a or not b:
        return False
    return normalizar_telefono(a) == normalizar_telefono(b)
