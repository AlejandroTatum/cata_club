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
import unicodedata
from datetime import date
from typing import Annotated, List, Optional

from pydantic import AfterValidator, EmailStr

from app.dominio.cedula import es_cedula_valida
from app.dominio.contrasenia import validar_contrasenia
from app.dominio.enums import TipoSangre
from app.dominio.excepciones import OperacionInvalida
from app.dominio.nombre_propio import normalizar_nombre_propio
from app.dominio.reglas_negocio import EDAD_MAYORIA_EDAD, calcular_edad
from app.dominio.telefono import (
    MENSAJE_TELEFONO_EMERGENCIA_IGUAL,
    es_telefono_valido,
    normalizar_telefono,
    telefonos_coinciden,
)
from app.soporte_transversal.tiempo import hoy_club


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


def _validar_formato_telefono(valor: str) -> str:
    # Issue #855: normaliza ANTES de exigir solo dígitos, así un celular
    # autocompletado en formato internacional (`+593991234567`) se convierte
    # a `09XXXXXXXX` antes de que el `+`/código de país lleguen a esta
    # comprobación -- el mismo orden que el frontend aplica en la máscara.
    normalizado = normalizar_telefono(valor)
    if not (normalizado.isascii() and normalizado.isdigit()):
        raise ValueError("El teléfono solo puede tener dígitos.")
    if not es_telefono_valido(normalizado):
        raise ValueError(
            "El teléfono debe tener 10 dígitos y empezar en 09, "
            "o 9 dígitos empezando en 0."
        )
    return normalizado


def _validar_telefono(valor: str) -> str:
    if not valor.strip():
        raise ValueError("El teléfono es obligatorio.")
    return _validar_formato_telefono(valor)


# Issue #1207: un menor representado no tiene celular propio, y el desk-edit
# del admin (o el "agregar dependiente" del portal) reenvía el valor tal como
# lo lee -- "" para ese menor. `_validar_telefono` de arriba lo rechazaba
# siempre con "obligatorio", sin importar de quién era el teléfono. Este
# validador tolera la ausencia Y la cadena vacía EXPLÍCITA (a diferencia de
# envolver `TelefonoValidado` en `Optional[...]`, que solo tolera que el
# campo no venga en el payload -- ver `EnrollmentAlumnoDTO.telefono`). Ambos
# casos se normalizan a `None`, así `Persona.telefono` (nullable desde la
# migración `l1207telnull`) persiste `NULL` y no `""`. Si el valor SÍ trae
# contenido, corre la misma regla de forma que `_validar_telefono` -- lo que
# esto relaja es la obligatoriedad, no el formato. Quién puede quedarse sin
# teléfono (un menor representado, nunca un adulto autogestionado) es una
# regla de negocio que necesita la fila real y no vive acá: la exige
# `PersonaCreateDTO._representante_solo_para_menor` en el alta (donde
# `representante_id` es parte del mismo payload) y
# `PersonaServicio.actualizar_persona` en la edición (donde solo el servicio
# conoce la Persona objetivo).
def _validar_telefono_opcional(valor: Optional[str]) -> Optional[str]:
    if valor is None or not valor.strip():
        return None
    return _validar_formato_telefono(valor)


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


# Issue #1323: un tester en staging pegó una frase entera ("asdajhdajdh
# asjhsdjashd sa") en «Nombres» y la regla la aceptó -- hasta acá el único
# chequeo era "no vacío". Ningún tope puede decidir si una cadena "parece un
# nombre" sin rechazar apellidos reales (#230 ya pagó ese costo), así que
# esto no es una heurística de plausibilidad: son tres topes de composición
# (palabras, letras por palabra, largo total) calibrados para dejar pasar
# cualquier nombre compuesto real ("María de los Ángeles", "De la Cruz
# Andrade") y frenar una frase pegada, un nombre duplicado o teclas
# apretadas. Mismos tres mensajes, en el mismo orden, que
# `personNameRule` en `identity-validation.ts` del frontend.
_NOMBRE_PROPIO_MAX_PALABRAS = 5
_NOMBRE_PROPIO_MAX_LETRAS_POR_PALABRA = 20
_NOMBRE_PROPIO_MAX_CARACTERES = 60


def _validar_tope_nombre_propio(valor: str, etiqueta: str, error: type[Exception] = ValueError) -> None:
    palabras = valor.split(" ")
    if len(palabras) > _NOMBRE_PROPIO_MAX_PALABRAS:
        raise error(f"{etiqueta} no puede tener más de {_NOMBRE_PROPIO_MAX_PALABRAS} palabras.")
    if any(len(palabra) > _NOMBRE_PROPIO_MAX_LETRAS_POR_PALABRA for palabra in palabras):
        raise error(
            f"{etiqueta} no puede tener una palabra de más de "
            f"{_NOMBRE_PROPIO_MAX_LETRAS_POR_PALABRA} letras."
        )
    if len(valor) > _NOMBRE_PROPIO_MAX_CARACTERES:
        raise error(f"{etiqueta} no puede tener más de {_NOMBRE_PROPIO_MAX_CARACTERES} caracteres.")


# REG-01 (QA3): PostgreSQL no admite U+0000 en columnas de texto; llegaba
# hasta el INSERT y se convertía en 500. Se rechaza antes, como 422.
def _rechazar_nul(valor: str, etiqueta: str) -> None:
    if "\x00" in valor:
        raise ValueError(f"{etiqueta} contiene caracteres no permitidos.")


# ADM-05 (QA3) y REG-08 (QA4): lista blanca de caracteres de un nombre o
# apellido de persona -- letras Unicode (tildes, ñ, ü), espacio, apóstrofo y
# guion--, con al menos 2 letras. Evita que dígitos, puntos, marcado (`<b>`,
# `&`) o emoji lleguen a la base y de ahí a PDF, correos y pantallas. El
# mensaje NOMBRA los caracteres sobrantes (mismo texto que `personNameRule`
# en `identity-validation.ts`). Solo la usan `NombreValidado`/
# `ApellidoValidado` (nombres de persona); categorías, descuentos y tipos de
# membresía tienen sus propios DTOs y pueden llevar dígitos.
_NOMBRE_MIN_LETRAS = 2


def _es_marca_tras_letra(valor: str, i: int) -> bool:
    """Una marca combinante solo es válida justo después de una letra o de
    otra marca (misma regla que `personNameDisallowedChars` del frontend)."""
    return i > 0 and unicodedata.category(valor[i - 1])[0] in ("L", "M")


def _validar_caracteres_de_nombre(valor: str, etiqueta: str, error: type[Exception] = ValueError) -> None:
    no_permitidos = list(dict.fromkeys(
        c for i, c in enumerate(valor)
        if c not in " '-"
        and unicodedata.category(c)[0] != "L"
        and not (unicodedata.category(c)[0] == "M" and _es_marca_tras_letra(valor, i))
    ))
    if no_permitidos:
        raise error(
            f"{etiqueta} no puede contener " + ", ".join(f"“{c}”" for c in no_permitidos) + "."
        )
    if sum(unicodedata.category(c)[0] == "L" for c in valor) < _NOMBRE_MIN_LETRAS:
        raise error(f"{etiqueta} debe tener al menos {_NOMBRE_MIN_LETRAS} letras.")
    if valor[0] in " '-" or valor[-1] in " '-":
        raise error(f"{etiqueta} no puede empezar ni terminar con un espacio, guion o apóstrofe.")
    if any(a in " '-" and b in " '-" for a, b in zip(valor, valor[1:])):
        raise error(f"{etiqueta} no puede tener un espacio, guion o apóstrofe repetido.")


# H4 (QA4): la regla estricta (REG-08) solo se exige a un nombre NUEVO o
# CAMBIADO. Las filas guardadas antes de la regla («Jr.», un «·») no pueden
# bloquear una edición ajena, así que `PersonaUpdateDTO` solo normaliza y
# exige que no esté vacío (`NombreEditable`/`ApellidoEditable`);
# `PersonaServicio.actualizar_persona` aplica `validar_nombre_cambiado` solo
# si el valor normalizado difiere del guardado.
def _normalizar_nombre_basico(valor: str, etiqueta_sustantivo: str) -> str:
    _rechazar_nul(valor, f"El {etiqueta_sustantivo}")
    if not valor.strip():
        raise ValueError(f"El {etiqueta_sustantivo} es obligatorio.")
    return normalizar_nombre_propio(valor)


def _validar_nombre_estricto(
    normalizado: str, etiqueta_sustantivo: str, error: type[Exception] = ValueError,
) -> str:
    _validar_caracteres_de_nombre(normalizado, f"El {etiqueta_sustantivo}", error)
    _validar_tope_nombre_propio(normalizado, f"El {etiqueta_sustantivo}", error)
    return normalizado


def _validar_nombre(valor: str) -> str:
    return _validar_nombre_estricto(_normalizar_nombre_basico(valor, "nombre"), "nombre")


def _validar_apellido(valor: str) -> str:
    return _validar_nombre_estricto(_normalizar_nombre_basico(valor, "apellido"), "apellido")


def _normalizar_nombre_editable(valor: str) -> str:
    return _normalizar_nombre_basico(valor, "nombre")


def _normalizar_apellido_editable(valor: str) -> str:
    return _normalizar_nombre_basico(valor, "apellido")


def validar_nombre_cambiado(campo: str, nuevo: str, guardado: str | None) -> str:
    """`campo` es `"nombres"` o `"apellidos"`. Devuelve `nuevo` (ya normalizado
    por el DTO) sin exigir la regla estricta si es igual al valor guardado
    (comparado en forma NFC y normalizada); si cambió, la exige completa y
    lanza `OperacionInvalida` con el mismo mensaje que el alta."""
    sustantivo = "nombre" if campo == "nombres" else "apellido"
    if guardado is not None and nuevo in (guardado, normalizar_nombre_propio(guardado)):
        return nuevo
    return _validar_nombre_estricto(nuevo, sustantivo, OperacionInvalida)


# Issue #875: `contacto_emergencia` (el NOMBRE de a quién llamar) es la
# misma clase de dato que `nombres`/`apellidos`, así que se normaliza igual.
# A diferencia de esos dos, acá `None`/vacío es legítimo ("todavía no se
# cargó") -- por eso este validador tolera ambos en vez de rechazarlos; el
# `Optional[...]` en el tipo hace que `None` ni siquiera lo alcance.
# Issue #827/#1016 (ADR-3): dos correos que difieren solo en mayúsculas o
# espacios al borde son la MISMA identidad para este sistema.
# `UsuarioRepositorio.obtener_por_correo` ya busca por
# `func.lower(correo) == correo.strip().lower()` -- si el DTO no deja el
# valor en esa misma forma ANTES de guardarlo, la fila persistida y la
# consulta que la busca divergen, y dos registros que solo difieren en
# capitalización pasan cada uno su propio pre-check (la carrera que cierra
# el índice único funcional de `modelos.py:248`, no este validador).
# Corre DESPUÉS de que `EmailStr` valida el formato: recibe un correo ya
# sintácticamente válido y solo lo normaliza.
# REG-02 (QA3): `Usuario.correo` es `String(100)`; un correo más largo pasaba
# `EmailStr` y reventaba en el INSERT con un 500.
_CORREO_MAX_CARACTERES = 100


def _normalizar_correo(valor: str) -> str:
    normalizado = valor.strip().lower()
    if len(normalizado) > _CORREO_MAX_CARACTERES:
        raise ValueError(
            f"El correo no puede tener más de {_CORREO_MAX_CARACTERES} caracteres."
        )
    return normalizado


# REG-03 (QA3): cada enfermedad es UNA fila de `Enfermedades.nombre_enfermedad`
# (`String(150)`), así que el tope es por elemento. Sin él, un texto largo
# reventaba el INSERT con un 500.
_ENFERMEDAD_MAX_CARACTERES = 150


def _validar_enfermedad(valor: str) -> str:
    if len(valor) > _ENFERMEDAD_MAX_CARACTERES:
        raise ValueError(
            f"Cada enfermedad no puede tener más de {_ENFERMEDAD_MAX_CARACTERES} caracteres."
        )
    return valor


def _sin_repetidos_ni_vacias(valores: List[str]) -> List[str]:
    """Quita las entradas vacías y las repetidas (sin distinguir mayúsculas),
    conservando el orden de la primera aparición (ADMA-30)."""
    vistos: set[str] = set()
    resultado: List[str] = []
    for valor in valores:
        limpio = valor.strip()
        if limpio and limpio.casefold() not in vistos:
            vistos.add(limpio.casefold())
            resultado.append(limpio)
    return resultado


def _validar_contacto_emergencia(valor: str) -> str:
    if not valor.strip():
        return valor
    return normalizar_nombre_propio(valor)


# Issue #1017 (ADR-5): la regla en sí (piso + lista negra) vive en
# `dominio/contrasenia.py`, igual que `_validar_cedula` reusa
# `es_cedula_valida`. `validar_contrasenia` ya lanza `ValueError` en
# castellano, así que este `AfterValidator` solo lo conecta -- no normaliza
# ni recorta el valor: la contraseña que se hashea es la que el usuario
# escribió.
def _validar_contrasenia(valor: str) -> str:
    validar_contrasenia(valor)
    return valor


def validar_telefono_emergencia_distinto(
    telefono_personal: Optional[str], telefono_emergencia: Optional[str],
) -> None:
    """Cross-check de DTO compartido por `EnrollmentCreateDTO`,
    `RepresentadoCreateDTO` y `AdminCrearCuentaDTO` (issue #860): un contacto
    de emergencia pierde su función si es el mismo número que el personal.

    Ambos valores ya llegan normalizados por `TelefonoValidado`
    (`AfterValidator` corre antes que un `model_validator(mode="after")`),
    así que la comparación de `telefonos_coinciden` alcanza; no hace falta
    normalizar de nuevo acá. No dispara si cualquiera de los dos está
    ausente: el teléfono personal es opcional en algunos caminos, y esta
    regla nunca lo vuelve obligatorio."""
    if telefonos_coinciden(telefono_personal, telefono_emergencia):
        raise ValueError(MENSAJE_TELEFONO_EMERGENCIA_IGUAL)


# Issue #1137, invariante (A): "una persona con `representante_id` es
# siempre menor de edad". El trigger de base `i1141relinteg`
# (`exigir_relacion_representacion_valida`) ya lo exige como defensa de
# última línea; esta función lo adelanta a la capa de DTO -- ANTES de
# escribir -- para que la respuesta sea un 422 en castellano y no el
# `IntegrityError` genérico que translada `main.py`.
#
# Comparten esta función `EnrollmentCreateDTO` (enrollment_schemas.py) y
# `PersonaCreateDTO`/`RepresentadoCreateDTO` (persona_schemas.py): las tres
# puertas de escritura que pueden dejar una fila con `representante_id`
# seteado. `VincularRepresentadoDTO` no la necesita -- no recibe
# `fecha_nacimiento`, reasigna una Persona ya existente, y
# `PersonaServicio._resolver_representado_elegible` ya exige la misma edad
# contra la fila real antes de reasignar.
def validar_representante_solo_para_menor(
    fecha_nacimiento: date, representante_presente: bool,
) -> None:
    if representante_presente and calcular_edad(fecha_nacimiento, hoy_club()) >= EDAD_MAYORIA_EDAD:
        raise ValueError(
            "Un representante legal no puede vincularse a una persona mayor "
            "de edad."
        )


CedulaValidada = Annotated[str, AfterValidator(_validar_cedula)]
TelefonoValidado = Annotated[str, AfterValidator(_validar_telefono)]
# Issue #1207. Ver el docstring de `_validar_telefono_opcional`.
TelefonoValidadoOpcional = Annotated[Optional[str], AfterValidator(_validar_telefono_opcional)]
# Issue #643. `TipoSangre` a secas sigue sirviendo para LEER una ficha
# (`FichaMedicaResponseDTO`, `FichaEmergenciaResponseDTO`); este alias es el
# que se usa para ESCRIBIR una.
TipoSangreValidado = Annotated[TipoSangre, AfterValidator(_validar_tipo_sangre)]
# `PersonaUpdateDTO.nombres`/`apellidos` (issue #312, hallazgo #65): antes
# dependían del `min_length=1` propio de `Field`, cuyo mensaje de rechazo
# ("String should have at least 1 character") es inglés de Pydantic y nunca
# pasa el filtro `isUserFacingText` del frontend -- el mismo motivo por el que
# cédula/teléfono ya usan un `AfterValidator` con mensaje en castellano en vez
# de una constraint de `Field`. Issue #1323 aplica el mismo criterio al tope
# de largo: los DTOs que usan estos dos alias ya NO llevan `max_length` en su
# `Field` -- `_validar_tope_nombre_propio` de arriba es la única fuente del
# tope de 60 caracteres, con el mismo mensaje en castellano que las otras dos
# causas que ya comparte.
NombreValidado = Annotated[str, AfterValidator(_validar_nombre)]
ApellidoValidado = Annotated[str, AfterValidator(_validar_apellido)]
# H4: solo `PersonaUpdateDTO`; ver `validar_nombre_cambiado`.
NombreEditable = Annotated[str, AfterValidator(_normalizar_nombre_editable)]
ApellidoEditable = Annotated[str, AfterValidator(_normalizar_apellido_editable)]
ContactoEmergenciaValidado = Annotated[str, AfterValidator(_validar_contacto_emergencia)]
EnfermedadValidada = Annotated[str, AfterValidator(_validar_enfermedad)]
EnfermedadesValidadas = Annotated[List[EnfermedadValidada], AfterValidator(_sin_repetidos_ni_vacias)]
CorreoValidado = Annotated[EmailStr, AfterValidator(_normalizar_correo)]
ContraseniaValidada = Annotated[str, AfterValidator(_validar_contrasenia)]


def _normalizar_si_presente(valor: Optional[str]) -> Optional[str]:
    return normalizar_nombre_propio(valor) if valor else valor


# Issue #875: fallback de LECTURA -- una fila legacy (escrita antes del
# límite de escritura de arriba) todavía guarda `nombres`/`apellidos` crudos.
# `normalizar_nombre_propio` es idempotente, así que aplicarla de nuevo sobre
# un valor ya canónico (escrito después del límite) no cambia nada.
# Misma regla POR CAMPO que `nombre_completo` (dominio/nombre_propio.py): un
# campo suelto y un nombre completo arman el mismo valor para la misma fila.
NombrePresentado = Annotated[str, AfterValidator(normalizar_nombre_propio)]
NombrePresentadoOpcional = Annotated[Optional[str], AfterValidator(_normalizar_si_presente)]
