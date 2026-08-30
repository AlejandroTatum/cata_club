"""
Validadores de identidad compartidos por los DTOs de entrada (PR 4b, issue
#228: "una regla de identidad que solo vive en el navegador no es una
regla"). Antes de este módulo, cada DTO repetía su propio
`pattern=r"^\\d{10}$"` de Pydantic -- eso solo comprueba el largo, así que
cualquier secuencia de 10 dígitos entraba, dígito verificador o provincia
inexistentes incluidos.

Se define una sola vez acá y se reusa vía `Annotated` (`CedulaValidada`,
`TelefonoValidado`) en cada DTO que recibe cédula o teléfono, en vez de
repetir el `field_validator` en cada clase. El largo lo valida el propio
validador -- no `Field(pattern=...)` -- para poder distinguir en castellano
"no tiene el largo correcto" de "ese número no es válido": son dos errores
y se corrigen distinto.
"""
from typing import Annotated

from pydantic import AfterValidator

from app.dominio.cedula import es_cedula_valida
from app.dominio.enums import TipoSangre
from app.dominio.telefono import es_telefono_valido


# `isascii()` antes de `isdigit()`, igual que en `dominio/cedula.py` y
# `dominio/telefono.py`: `str.isdigit()` sola acepta dígitos no ASCII
# (arábigo-índicos `٠١٢`, devanagari...). Estos pre-chequeos NO deciden qué
# entra -- los validadores canónicos ya rechazan esos valores igual -- pero
# sin el `isascii()` un `'٠٩'+'١'*8` caía en la SEGUNDA rama y el usuario leía
# "debe tener 10 dígitos y empezar en 09" en vez de "solo puede tener
# dígitos". Las dos capas tienen que coincidir en qué es un dígito para que
# el mensaje nombre el problema real.
def _validar_cedula(valor: str) -> str:
    if not (valor.isascii() and valor.isdigit()) or len(valor) != 10:
        raise ValueError("La cédula debe tener exactamente 10 dígitos.")
    if not es_cedula_valida(valor):
        raise ValueError("Ese número de cédula no es válido.")
    return valor


def _validar_telefono(valor: str) -> str:
    if not valor.strip():
        raise ValueError("El teléfono es obligatorio.")
    if not (valor.isascii() and valor.isdigit()):
        raise ValueError("El teléfono solo puede tener dígitos.")
    if not es_telefono_valido(valor):
        raise ValueError(
            "El teléfono debe tener 10 dígitos y empezar en 09, "
            "o 9 dígitos empezando en 0."
        )
    return valor


def _validar_tipo_sangre(valor: TipoSangre) -> TipoSangre:
    """Issue #643: `DESCONOCIDO` no es un tipo de sangre, es la ausencia de
    uno.

    Sigue existiendo en el enum, y tiene que seguir existiendo: las fichas
    escritas antes de esta regla lo tienen grabado, y ninguna migración puede
    reemplazarlo sin inventar el dato. Lo que deja de poder es ENTRAR. La
    distinción vive acá, al lado de cédula y teléfono, por el mismo motivo que
    ellas: es una regla de negocio, no un detalle de formato, y una sola copia
    evita que cada DTO decida por su cuenta qué cuenta como tipo de sangre.
    """
    if valor is TipoSangre.DESCONOCIDO:
        raise ValueError(
            "Debe indicar el tipo de sangre: «No lo sé» no es una opción "
            "válida para una ficha médica."
        )
    return valor


def _validar_nombre(valor: str) -> str:
    if not valor.strip():
        raise ValueError("El nombre es obligatorio.")
    return valor


def _validar_apellido(valor: str) -> str:
    if not valor.strip():
        raise ValueError("El apellido es obligatorio.")
    return valor


CedulaValidada = Annotated[str, AfterValidator(_validar_cedula)]
TelefonoValidado = Annotated[str, AfterValidator(_validar_telefono)]
# Issue #643. `TipoSangre` a secas sigue sirviendo para LEER una ficha
# (`FichaMedicaResponseDTO`, `FichaEmergenciaResponseDTO`); este alias es el
# que se usa para ESCRIBIR una.
TipoSangreValidado = Annotated[TipoSangre, AfterValidator(_validar_tipo_sangre)]
# `PersonaUpdateDTO.nombres`/`apellidos` (issue #312, hallazgo #65): antes
# dependían del `min_length=1` propio de `Field`, cuyo mensaje de rechazo
# ("String should have at least 1 character") es inglés de Pydantic y nunca
# pasa el filtro `isUserFacingText` del frontend -- el mismo motivo por el que
# cédula/teléfono ya usan un `AfterValidator` con mensaje en castellano en vez
# de una constraint de `Field`.
NombreValidado = Annotated[str, AfterValidator(_validar_nombre)]
ApellidoValidado = Annotated[str, AfterValidator(_validar_apellido)]
