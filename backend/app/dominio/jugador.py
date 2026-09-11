"""
Issue #1132: la condición de jugador se deriva EXCLUSIVAMENTE de una
membresía ACTIVA -- nunca del rol.

Antes de esta corrección, tres lugares distintos preguntaban "¿es alumno?"
mirando el rol `ALUMNO` en vez de la membresía: `MembresiaServicio.
crear_membresia` (otorgaba el rol al matricularse), `RolServicio.
asignar_alumno_si_corresponde`/`exigir_que_pueda_ser_alumno` (la mitad que
mutaba y la mitad que validaba de esa asignación), y `AsistenciaServicio.
asignar_alumno_a_horario` (sin ningún chequeo de membresía). Un
representante que paga una membresía para sí mismo debe conservar su único
rol técnico REPRESENTANTE (issue #762) y contar como jugador sin que nadie
le otorgue ALUMNO -- por eso esta pregunta se saca del rol por completo y se
concentra acá, en un solo lugar.

Vive en `dominio`, junto a `rol_unico.py` y por la misma razón: es una
función pura sobre datos ya cargados, no toca la sesión ni decide cuándo
persistir -- eso lo sigue resolviendo cada servicio.
"""
from app.dominio.enums import EstadoMembresia


def es_jugador(membresias) -> bool:
    """True si, entre las `Membresia` dadas, alguna está ACTIVA ahora mismo.

    Es el predicado ÚNICO de "es jugador": ni el rol, ni `Usuario`, ni si la
    persona alguna vez pagó, deciden nada acá. Una membresía SUSPENDIDA o
    VENCIDA no cuenta -- para esta pregunta ("¿aparece como jugador en
    Miembros?") la respuesta es literal, no histórica.

    La pregunta distinta de "¿puede seguir entrenando aunque se le venza la
    cuota?" no la resuelve esta función: la resuelve la decisión de negocio
    #4 (ya vigente antes de este issue), en
    `MembresiaRepositorio.puede_entrenar`."""
    return any(membresia.estado == EstadoMembresia.ACTIVA for membresia in membresias)
