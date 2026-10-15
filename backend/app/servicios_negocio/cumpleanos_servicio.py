"""Cumpleaños de los jugadores del club (S6).

Un jugador es una persona ACTIVA con una membresía ACTIVA (la misma población
que cuenta el Panel en "Membresías activas"). Quien tiene una supresión de datos
ejecutada (issue #1062) no figura: su identidad ya no existe y su fila queda
anonimizada. El día es el del CLUB (`hoy_club()`), no el del contenedor.

Quien nació un 29 de febrero cumple el 28 de febrero en los años no bisiestos.
"""
import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import and_, exists, extract, or_, select
from sqlalchemy.orm import Session

from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import Persona, SolicitudSupresionDatos
from app.dominio.nombre_propio import nombre_completo
from app.dominio.reglas_negocio import calcular_edad
from app.soporte_transversal.tiempo import hoy_club


@dataclass(frozen=True)
class CumpleanosHoy:
    nombre: str
    edad: int


def _fechas_de_cumpleanos(hoy: date) -> list[tuple[int, int]]:
    """`(mes, día)` de nacimiento que cumplen años en `hoy`."""
    fechas = [(hoy.month, hoy.day)]
    if (hoy.month, hoy.day) == (2, 28) and not calendar.isleap(hoy.year):
        fechas.append((2, 29))
    return fechas


def cumpleanos_de_hoy(db: Session, hoy: date | None = None) -> list[CumpleanosHoy]:
    """Jugadores que cumplen años en `hoy` (día del club por defecto), con la
    edad que cumplen, ordenados por nombre. Nacer hoy no es un cumpleaños."""
    hoy = hoy or hoy_club()
    coincide = or_(*[
        and_(
            extract("month", Persona.fecha_nacimiento) == mes,
            extract("day", Persona.fecha_nacimiento) == dia,
        )
        for mes, dia in _fechas_de_cumpleanos(hoy)
    ])
    suprimida = exists().where(
        SolicitudSupresionDatos.persona_id == Persona.id,
        SolicitudSupresionDatos.estado == "EJECUTADA",
    )
    personas = db.execute(
        select(Persona).where(
            Persona.activo.is_(True),
            coincide,
            Persona.membresias.any(estado=EstadoMembresia.ACTIVA),
            ~suprimida,
        )
    ).scalars().all()

    cumpleaneros = []
    for persona in personas:
        nacimiento = persona.fecha_nacimiento
        # El 28/feb de un año no bisiesto el nacido el 29/feb ya "cumplió":
        # se mide contra el día siguiente para que la edad no quede en uno menos.
        nacido_el_29_de_febrero = (nacimiento.month, nacimiento.day) == (2, 29)
        referencia = hoy + timedelta(days=1) if nacido_el_29_de_febrero and hoy.day == 28 else hoy
        edad = calcular_edad(nacimiento, referencia)
        if edad > 0:
            cumpleaneros.append(
                CumpleanosHoy(nombre_completo(persona.nombres, persona.apellidos), edad)
            )
    return sorted(cumpleaneros, key=lambda c: c.nombre.casefold())
