"""Fuente única de verdad para las 5 categorías fijas de horario.

Son constantes de negocio confirmadas con el usuario: no se editan en
runtime ni se guardan en una tabla -- un `dict` en memoria es suficiente y
evita un join sin beneficio real. `HorarioEntrenamiento.hora_inicio`/`hora_fin`
siempre se derivan de aquí a partir de la `categoria` elegida; el cliente
nunca puede enviarlos directamente (ver `asistencia_schemas.HorarioCreateDTO`).
"""
from dataclasses import dataclass
from datetime import time

from app.dominio.enums import Categoria, DiaSemana

_LUN_VIE: frozenset[DiaSemana] = frozenset({
    DiaSemana.LUNES,
    DiaSemana.MARTES,
    DiaSemana.MIERCOLES,
    DiaSemana.JUEVES,
    DiaSemana.VIERNES,
})
_LUN_SAB: frozenset[DiaSemana] = _LUN_VIE | {DiaSemana.SABADO}


@dataclass(frozen=True)
class CategoriaInfo:
    label: str
    hora_inicio: time
    hora_fin: time
    dias: frozenset[DiaSemana]


CATEGORIA_METADATA: dict[Categoria, CategoriaInfo] = {
    Categoria.FORMATIVO: CategoriaInfo(
        label="Formativo",
        hora_inicio=time(15, 0), hora_fin=time(16, 0), dias=_LUN_VIE,
    ),
    Categoria.INFANTIL: CategoriaInfo(
        label="Infantil",
        hora_inicio=time(16, 0), hora_fin=time(17, 0), dias=_LUN_VIE,
    ),
    Categoria.JUVENIL: CategoriaInfo(
        label="Juvenil",
        hora_inicio=time(17, 0), hora_fin=time(18, 0), dias=_LUN_VIE,
    ),
    Categoria.COMPETITIVO: CategoriaInfo(
        label="Competitivo",
        hora_inicio=time(18, 0), hora_fin=time(20, 0), dias=_LUN_SAB,
    ),
    Categoria.ADULTOS: CategoriaInfo(
        label="Adultos",
        hora_inicio=time(20, 0), hora_fin=time(21, 15), dias=_LUN_VIE,
    ),
}


def dias_permitidos(categoria: Categoria) -> frozenset[DiaSemana]:
    return CATEGORIA_METADATA[categoria].dias


def horario_de(categoria: Categoria) -> tuple[time, time]:
    info = CATEGORIA_METADATA[categoria]
    return info.hora_inicio, info.hora_fin
