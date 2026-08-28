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
    fin_del_dia_club,
    hoy_club,
    inicio_del_dia_club,
    rango_de_dias_club,
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


# --- Límites de un día del club (issue #761) --------------------------------
# La traducción en el sentido inverso a `hoy_club()`: de un DÍA del club a los
# instantes en que ese día empieza y termina. Hace falta para filtrar columnas
# que guardan INSTANTES (`timestamptz`) con un rango que el cliente expresa en
# días del club.

def test_el_dia_del_club_empieza_a_las_cinco_utc():
    """00:00 en el club son las 05:00 UTC, no las 00:00 UTC."""
    inicio = inicio_del_dia_club(date(2026, 1, 15))
    assert inicio.utcoffset() == timedelta(hours=-5)
    assert inicio.astimezone(timezone.utc) == datetime(2026, 1, 15, 5, 0, tzinfo=timezone.utc)


def test_el_dia_del_club_termina_pasada_la_medianoche_utc():
    """El tope del día del club cae en la MADRUGADA UTC del día siguiente:
    justo el tramo que un rango armado en UTC dejaba afuera."""
    fin = fin_del_dia_club(date(2026, 1, 15))
    assert fin.astimezone(timezone.utc) == datetime(
        2026, 1, 16, 4, 59, 59, 999999, tzinfo=timezone.utc
    )


def test_los_limites_contienen_al_instante_de_la_noche_del_club():
    """Cierre del círculo con `hoy_club()`: un instante cuyo día del club es
    D cae siempre dentro de los límites de D, aunque su día UTC sea D+1."""
    assert hoy_club(INSTANTE_NOCHE_DEL_CLUB) == date(2026, 1, 15)
    assert inicio_del_dia_club(date(2026, 1, 15)) <= INSTANTE_NOCHE_DEL_CLUB
    assert INSTANTE_NOCHE_DEL_CLUB <= fin_del_dia_club(date(2026, 1, 15))


def test_los_limites_de_dos_dias_consecutivos_no_dejan_hueco():
    """`time.max` es 23:59:59.999999, la misma resolución de microsegundo que
    guarda `timestamptz`: entre el fin de un día y el inicio del siguiente no
    queda ningún instante representable sin cubrir."""
    fin = fin_del_dia_club(date(2026, 1, 15))
    inicio_siguiente = inicio_del_dia_club(date(2026, 1, 16))
    assert inicio_siguiente - fin == timedelta(microseconds=1)


def test_rango_de_dias_club_devuelve_los_dos_limites():
    inicio, fin = rango_de_dias_club(date(2026, 1, 15), date(2026, 1, 16))
    assert inicio == inicio_del_dia_club(date(2026, 1, 15))
    assert fin == fin_del_dia_club(date(2026, 1, 16))


def test_rango_de_dias_club_deja_pasar_los_extremos_sin_limite():
    """`None` significa "sin límite de ese lado", no "hoy": la cola de
    validación de pagos comparte consulta con el reporte pero no filtra por
    fecha, y tiene que seguir viendo todo."""
    assert rango_de_dias_club(None, None) == (None, None)

    inicio, fin = rango_de_dias_club(date(2026, 1, 15), None)
    assert inicio == inicio_del_dia_club(date(2026, 1, 15))
    assert fin is None
