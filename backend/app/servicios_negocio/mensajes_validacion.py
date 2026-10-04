"""Traducción de los errores de validación de Pydantic a castellano llano (ADMB-12, ENT-16).

Pydantic devuelve sus mensajes en inglés («Field required», «Input should be
greater than or equal to 1.00»). Un 422 llega a la pantalla tal cual, así que
cada tipo de error conocido se reescribe en «usted», diciendo cómo corregirlo.
Los mensajes en castellano que escribimos nosotros (`ValueError` de un
validador) pasan sin tocar, solo sin el prefijo «Value error, ».
"""
import re
from decimal import Decimal, InvalidOperation

MENSAJE_GENERICO = "Uno de los datos enviados no es válido. Revisa la información e intenta nuevamente."

_PREFIJO_VALUE_ERROR = "Value error, "

# Nombre del campo -> cómo se le dice a la persona en el mensaje.
_CAMPOS_EN_DINERO = {"precio", "monto", "tarifa_mensual_aplicada"}
_AL_MENOS_UNO = {"dias": "Elige al menos un día.", "items": "Debes enviar al menos un jugador."}


def _numero(valor) -> str:
    """Número con coma decimal, sin ceros de más: 1.00 -> «1,00», 5 -> «5»."""
    try:
        texto = format(Decimal(str(valor)), "f")
    except (InvalidOperation, ValueError):
        return str(valor)
    return texto.replace(".", ",")


def _campo(error: dict) -> str:
    ubicacion = [parte for parte in error.get("loc", ()) if isinstance(parte, str)]
    return ubicacion[-1] if ubicacion else ""


def _cantidad(valor, singular: str, plural: str) -> str:
    return f"{valor} {singular if valor == 1 else plural}"


def _texto_corto(ctx: dict, campo: str) -> str:
    minimo = ctx.get("min_length", 1)
    if minimo <= 1:
        return "Este campo es obligatorio."
    return f"Use al menos {_cantidad(minimo, 'carácter', 'caracteres')}."


def _lista_corta(ctx: dict, campo: str) -> str:
    minimo = ctx.get("min_length", 1)
    if minimo == 1 and campo in _AL_MENOS_UNO:
        return _AL_MENOS_UNO[campo]
    return f"Debes indicar al menos {_cantidad(minimo, 'elemento', 'elementos')}."


def _minimo(ctx: dict, campo: str) -> str:
    limite = _numero(ctx.get("ge"))
    if campo in _CAMPOS_EN_DINERO:
        return f"El {'precio' if campo == 'precio' else 'monto'} debe ser de ${limite} o más."
    return f"El valor debe ser {limite} o más."


def _maximo(ctx: dict, campo: str) -> str:
    limite = _numero(ctx.get("le"))
    if campo in _CAMPOS_EN_DINERO:
        return f"El monto no puede ser mayor que ${limite}."
    return f"El valor no puede ser mayor que {limite}."


_NUMERO_INVALIDO = "Ingresa un número válido."

# Tipo de error de Pydantic -> función (ctx, campo) -> mensaje.
_TRADUCTORES = {
    "missing": lambda ctx, campo: "Este campo es obligatorio.",
    "string_too_short": _texto_corto,
    "string_too_long": lambda ctx, campo: f"Use hasta {_cantidad(ctx.get('max_length'), 'carácter', 'caracteres')}.",
    "too_short": _lista_corta,
    "too_long": lambda ctx, campo: f"Puede enviar hasta {_cantidad(ctx.get('max_length'), 'elemento', 'elementos')}.",
    "greater_than_equal": _minimo,
    "greater_than": lambda ctx, campo: f"El valor debe ser mayor que {_numero(ctx.get('gt'))}.",
    "less_than_equal": _maximo,
    "less_than": lambda ctx, campo: f"El valor debe ser menor que {_numero(ctx.get('lt'))}.",
    "decimal_max_places": lambda ctx, campo: (
        f"Use hasta {_cantidad(ctx.get('decimal_places', 2), 'decimal', 'decimales')} (por ejemplo 0,5)."
    ),
    "decimal_max_digits": lambda ctx, campo: "El número es demasiado grande.",
    "decimal_whole_digits": lambda ctx, campo: "El número es demasiado grande.",
    "enum": lambda ctx, campo: "Elige una opción válida de la lista.",
    "literal_error": lambda ctx, campo: "Elige una opción válida de la lista.",
    "bool_parsing": lambda ctx, campo: "Elige Sí o No.",
    "bool_type": lambda ctx, campo: "Elige Sí o No.",
    "json_invalid": lambda ctx, campo: "Los datos enviados no tienen un formato válido.",
}
for _tipo in ("int_parsing", "int_from_float", "int_type", "float_parsing", "float_type", "decimal_parsing", "decimal_type"):
    _TRADUCTORES[_tipo] = lambda ctx, campo: _NUMERO_INVALIDO


def _mensaje_propio(error: dict) -> str:
    """Un `ValueError` de un validador nuestro ya viene en castellano."""
    mensaje = error.get("msg", "")
    if mensaje.startswith(_PREFIJO_VALUE_ERROR):
        mensaje = mensaje[len(_PREFIJO_VALUE_ERROR):]
    return mensaje or MENSAJE_GENERICO


def traducir_error_validacion(error: dict) -> str:
    tipo = error.get("type", "")
    if tipo in ("value_error", "assertion_error"):
        return _mensaje_propio(error)
    if tipo.startswith(("date", "datetime")):
        return "Ingresa una fecha válida."
    if tipo.startswith("time"):
        return "Ingresa una hora válida."
    traductor = _TRADUCTORES.get(tipo)
    if traductor is None:
        return MENSAJE_GENERICO
    return traductor(error.get("ctx") or {}, _campo(error))


# `leer_con_limite` (soporte_transversal) informa el tope en bytes.
_TAMANO_EN_BYTES = re.compile(r"El archivo excede el tamaño máximo permitido de (\d+) bytes")


def mensaje_con_tamano_en_mb(mensaje: str) -> str:
    """Reescribe «…permitido de 5242880 bytes» como «El archivo pesa más de 5 MB…»."""
    coincidencia = _TAMANO_EN_BYTES.fullmatch(mensaje)
    if coincidencia is None:
        return mensaje
    megas = int(coincidencia.group(1)) / (1024 * 1024)
    return f"El archivo pesa más de {_numero(round(megas, 1)).removesuffix(',0')} MB. Elige uno más liviano."
