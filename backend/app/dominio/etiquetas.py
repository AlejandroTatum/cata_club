"""
Cómo se nombra en castellano lo que adentro del sistema es un enum.

`TipoRol.ADMINISTRADOR` es un identificador: existe para que el código lo
compare, y está en mayúsculas porque así se escriben las constantes. Nada de
eso es asunto de un socio del club, que en una pantalla espera leer
"administrador".

Existe como módulo aparte, y no como un `.label` en cada enum, porque un enum
del dominio describe QUÉ estados hay; cómo se le cuenta cada estado a una
persona es una decisión de redacción que cambia por su cuenta. `Categoria`
tenía su etiqueta en `CATEGORIA_METADATA` (un `dict` en memoria); ahora que
esos datos viven en la tabla `categoria_horario` (M1), esta etiqueta se
desacopla de ahí: es vocabulario de redacción, no la fuente de verdad de
`hora_inicio`/`hora_fin` -- duplicarla acá es igual de seguro que `_DIAS` o
`_ROLES` de más abajo.

Los diccionarios son totales a propósito: si mañana aparece un miembro nuevo
sin etiqueta, `tests/test_vocabulario_en_mensajes_de_usuario.py` lo detecta
antes de que un `KeyError` llegue a producción.
"""
from app.dominio.enums import Categoria, DiaSemana, EstadoPago, TipoRol


_DIAS: dict[DiaSemana, str] = {
    DiaSemana.LUNES: "lunes",
    DiaSemana.MARTES: "martes",
    DiaSemana.MIERCOLES: "miércoles",
    DiaSemana.JUEVES: "jueves",
    DiaSemana.VIERNES: "viernes",
    DiaSemana.SABADO: "sábado",
    DiaSemana.DOMINGO: "domingo",
}

_ROLES: dict[TipoRol, str] = {
    TipoRol.ALUMNO: "alumno",
    TipoRol.ENTRENADOR: "entrenador",
    TipoRol.ADMINISTRADOR: "administrador",
    TipoRol.REPRESENTANTE: "representante",
}

# "pendiente de validación" y no "pendiente": la frase que lo usa contrasta
# los tres estados y "pendiente" solo no dice pendiente de qué.
_ESTADOS_DE_PAGO: dict[EstadoPago, str] = {
    EstadoPago.APROBADO: "aprobado",
    EstadoPago.PENDIENTE_VALIDACION: "pendiente de validación",
    EstadoPago.RECHAZADO: "rechazado",
}

_CATEGORIAS: dict[Categoria, str] = {
    Categoria.FORMATIVO: "Formativo",
    Categoria.INFANTIL: "Infantil",
    Categoria.JUVENIL: "Juvenil",
    Categoria.COMPETITIVO: "Competitivo",
    Categoria.ADULTOS: "Adultos",
}


def dia_en_castellano(dia: DiaSemana) -> str:
    return _DIAS[dia]


def rol_en_castellano(rol: TipoRol) -> str:
    return _ROLES[rol]


def estado_de_pago_en_castellano(estado: EstadoPago) -> str:
    return _ESTADOS_DE_PAGO[estado]


def categoria_en_castellano(categoria: Categoria | str) -> str:
    return _CATEGORIAS[Categoria(categoria)]
