"""
Pruebas del reloj del club (`app/soporte_transversal/tiempo.py`) y de que
cada sitio que necesita "el día de HOY del club" lo use.

El bug que cierran:
    Los contenedores corren en UTC (contrato deliberado: la BD guarda
    instantes, no horas locales — ver docker-compose.yml, donde NO se fija
    `TZ`). El club está en `America/Guayaquil` (UTC-5). `date.today()` en un
    proceso UTC devuelve el día UTC, así que entre las 19:00 y la medianoche
    hora del club YA devuelve MAÑANA: toda ventana de "hoy" queda corrida un
    día completo.

    El patrón correcto ya existía en el repositorio
    (`dashboard_router.py`, `celery_app.py::timezone`); lo que faltaba era
    tenerlo en UN solo lugar y aplicarlo en todos los sitios.
"""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.soporte_transversal.tiempo import (
    ZONA_HORARIA_CLUB,
    ahora_club,
    hoy_club,
)


# 02:00 UTC del 16 de enero son las 21:00 del 15 en Guayaquil: el instante
# exacto en el que `date.today()` de un contenedor UTC empieza a mentir.
INSTANTE_NOCHE_DEL_CLUB = datetime(2026, 1, 16, 2, 0, tzinfo=timezone.utc)


def test_la_zona_del_club_es_guayaquil():
    assert ZONA_HORARIA_CLUB == ZoneInfo("America/Guayaquil")


def test_hoy_club_no_adelanta_el_dia_de_noche():
    """El caso del bug: de noche en el club, el día UTC ya avanzó."""
    assert INSTANTE_NOCHE_DEL_CLUB.date() == date(2026, 1, 16)
    assert hoy_club(INSTANTE_NOCHE_DEL_CLUB) == date(2026, 1, 15)


def test_hoy_club_coincide_con_utc_durante_el_dia():
    mediodia_utc = datetime(2026, 1, 16, 12, 0, tzinfo=timezone.utc)
    assert hoy_club(mediodia_utc) == date(2026, 1, 16)


def test_hoy_club_acepta_un_instante_en_cualquier_zona():
    """El offset del instante recibido no importa: lo que se traduce es el
    INSTANTE, no el reloj de pared de quien lo construyó."""
    mismo_instante_en_utc_menos_8 = INSTANTE_NOCHE_DEL_CLUB.astimezone(
        timezone(timedelta(hours=-8))
    )
    assert hoy_club(mismo_instante_en_utc_menos_8) == date(2026, 1, 15)


def test_ahora_club_devuelve_un_instante_aware_en_la_zona_del_club():
    momento = ahora_club()
    assert momento.tzinfo is not None
    assert momento.utcoffset() == timedelta(hours=-5)


def test_hoy_club_sin_argumentos_usa_el_reloj_real():
    assert hoy_club() == ahora_club().date()
