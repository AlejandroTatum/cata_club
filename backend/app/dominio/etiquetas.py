"""
Cómo se nombra en castellano lo que adentro del sistema es un enum.

`TipoRol.ADMINISTRADOR` es un identificador: existe para que el código lo
compare, y está en mayúsculas porque así se escriben las constantes. Nada de
eso es asunto de un socio del club, que en una pantalla espera leer
"administrador".

Existe como módulo aparte, y no como un `.label` en cada enum, porque un enum
del dominio describe QUÉ estados hay; cómo se le cuenta cada estado a una
persona es una decisión de redacción que cambia por su cuenta. Los
diccionarios de este módulo son totales a propósito: si mañana aparece un
miembro nuevo sin etiqueta, `tests/test_vocabulario_en_mensajes_de_usuario.py`
lo detecta antes de que un `KeyError` llegue a producción -- una garantía que
solo tiene sentido para un enum CERRADO (`DiaSemana`, `TipoRol`, `EstadoPago`
de acá abajo).

`Categoria` ya no vive acá (M1): tenía su etiqueta en un `_CATEGORIAS` fijo de
5 entradas, pero la categoría de un horario hoy sale de la tabla
`categoria_horario` -- un admin puede sumar una fila que ese diccionario
nunca vería, y el `KeyError` que este módulo existe para evitar es
exactamente lo que un enum cerrado le haría a esa fila nueva. Su label
(`CategoriaHorario.label`) se lee donde ya se consulta la tabla --
`AsistenciaServicio._validar_dia_y_derivar_horas` -- no acá.
"""
from app.dominio.enums import DiaSemana, EstadoPago, TipoRol


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

def dia_en_castellano(dia: DiaSemana) -> str:
    return _DIAS[dia]


def rol_en_castellano(rol: TipoRol) -> str:
    return _ROLES[rol]


def estado_de_pago_en_castellano(estado: EstadoPago) -> str:
    return _ESTADOS_DE_PAGO[estado]
