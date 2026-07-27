"""
Reloj del club: única fuente de verdad sobre "qué día es HOY para el club".

Contrato de zonas horarias del sistema (deliberado, no accidental):
  - Los contenedores corren en UTC y la base guarda INSTANTES
    (`timestamptz`, migración `a7c1e9d4f6b2`). Fijar `TZ` en el contenedor
    para "arreglar" las fechas está prohibido: eso enmascara el problema y
    rompe el contrato de almacenamiento en UTC.
  - Cuando lo que importa NO es un instante sino un DÍA DE CALENDARIO del
    club (una ventana de vencimiento, una edad, la fecha impresa en un
    reporte), la traducción a la zona local se hace en el código, aquí.

Por qué `date.today()` es un bug en este sistema:
    `date.today()` devuelve el día del RELOJ DEL PROCESO, que es UTC. El
    club está en `America/Guayaquil` (UTC-5), así que entre las 19:00 y la
    medianoche hora del club `date.today()` ya devuelve MAÑANA y toda
    ventana de "hoy" queda corrida un día entero.

El patrón ya existía disperso en el repositorio (`dashboard_router.py`,
`celery_app.py::timezone`); este módulo lo centraliza para que agregar un
sitio nuevo no signifique volver a elegir zona horaria.
"""
from datetime import date, datetime
from typing import Optional
from zoneinfo import ZoneInfo


# Zona del club. Coincide con `celery_app.timezone`, que fija el calendario
# de Celery Beat: las tareas nocturnas y el código que corren tienen que
# estar de acuerdo sobre qué día es.
ZONA_HORARIA_CLUB = ZoneInfo("America/Guayaquil")


def ahora_club() -> datetime:
    """Instante actual, aware, expresado en la zona del club."""
    return datetime.now(ZONA_HORARIA_CLUB)


def hoy_club(instante: Optional[datetime] = None) -> date:
    """Día de calendario del club.

    Reemplaza a `date.today()` en todo sitio donde "hoy" significa el día
    del club y no el día del reloj del contenedor.

    Args:
        instante: instante aware a traducir. Se acepta como parámetro (en
            vez de leer siempre el reloj) para que las pruebas puedan fijar
            el momento sin parchear módulos. El offset del instante recibido
            es irrelevante: lo que se traduce es el instante, no el reloj de
            pared de quien lo construyó.
    """
    if instante is None:
        return ahora_club().date()
    return instante.astimezone(ZONA_HORARIA_CLUB).date()
