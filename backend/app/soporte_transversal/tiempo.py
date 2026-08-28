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
from datetime import date, datetime, time
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


def inicio_del_dia_club(fecha: date) -> datetime:
    """Primer instante de ese día de calendario del club.

    Contraparte de `hoy_club()` para el otro sentido de la traducción: no
    "qué día es este instante" sino "en qué instante empieza este día". Es lo
    que hace falta para filtrar una columna que guarda INSTANTES en UTC
    (`timestamptz`) con un rango que el cliente expresa en DÍAS del club.

    Construir ese límite con `tzinfo=timezone.utc` es el bug que documenta el
    issue #761: el club está en UTC-5, así que `día 00:00 UTC` es en realidad
    las 19:00 del día ANTERIOR para el club, y `día 23:59:59 UTC` cae a las
    18:59:59 del propio día. Un rango armado así deja afuera las últimas
    cinco horas de cada día del club.
    """
    return datetime.combine(fecha, time.min, tzinfo=ZONA_HORARIA_CLUB)


def fin_del_dia_club(fecha: date) -> datetime:
    """Último instante de ese día de calendario del club (inclusive).

    Pareja de `inicio_del_dia_club`; ver ahí el porqué de la zona. Usa
    `time.max` (23:59:59.999999), la misma resolución de microsegundo que
    guarda `timestamptz` en Postgres, para que el extremo superior del rango
    sea inclusivo sin dejar un hueco.
    """
    return datetime.combine(fecha, time.max, tzinfo=ZONA_HORARIA_CLUB)


def rango_de_dias_club(
    fecha_inicio: Optional[date], fecha_fin: Optional[date],
) -> tuple[Optional[datetime], Optional[datetime]]:
    """Traduce un rango de DÍAS del club a los INSTANTES que lo delimitan,
    inclusive en ambos extremos.

    Es la forma en que los reportes usan `inicio_del_dia_club` /
    `fin_del_dia_club`, y vive acá para que exista UNA sola construcción del
    rango. Los dos reportes de `/reports` (pagos y alumnos nuevos por período)
    reciben sus fechas del mismo `buildReportDateRange` del frontend, que las
    expresa en días del club, y filtran columnas que guardan instantes en UTC:
    repetir el par en cada llamador es justamente cómo el issue #761 terminó
    arreglado en un reporte y vivo en el otro.

    Un extremo en `None` queda en `None`: significa "sin límite de ese lado",
    no "hoy". Lo usa la cola de validación de pagos, que comparte consulta con
    el reporte pero no filtra por fecha.
    """
    inicio = inicio_del_dia_club(fecha_inicio) if fecha_inicio is not None else None
    fin = fin_del_dia_club(fecha_fin) if fecha_fin is not None else None
    return inicio, fin
