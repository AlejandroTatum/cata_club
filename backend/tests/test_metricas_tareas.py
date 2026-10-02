"""Tareas de Celery del colector y retención (issue #1314).

Dos entradas en el beat: la instantánea cada minuto y la purga diaria. La
purga conserva 7 días de instantáneas (el rango máximo de "Métricas
avanzadas") y 35 de actividad diaria (el rango máximo de "Resumen" es 30 días
más el día en curso, con margen).
"""
from datetime import date, datetime, timedelta, timezone

from celery.schedules import crontab
from sqlalchemy import select

from app.dominio.modelos import ActividadUsuario, MetricaInstantanea
from app.infraestructura import colector_metricas as cm
from app.infraestructura.tareas import metricas_tareas
from app.infraestructura.tareas.celery_app import celery_app
from tests.fabricas_auth import crear_usuario_auth

AHORA = datetime(2026, 10, 1, 20, 30, tzinfo=timezone.utc)


def test_el_beat_programa_la_instantanea_cada_minuto():
    entrada = celery_app.conf.beat_schedule["capturar-metricas-cada-minuto"]

    assert entrada["task"] == "app.infraestructura.tareas.metricas_tareas.capturar_metricas"
    assert entrada["schedule"] == crontab(minute="*/1")


def test_el_beat_programa_la_purga_diaria_de_metricas_y_actividad():
    entrada = celery_app.conf.beat_schedule["purgar-metricas-y-actividad-diario"]

    assert entrada["task"] == "app.infraestructura.tareas.metricas_tareas.purgar_metricas_y_actividad"


def test_las_tareas_estan_registradas_en_celery():
    assert "app.infraestructura.tareas.metricas_tareas.capturar_metricas" in celery_app.tasks
    assert "app.infraestructura.tareas.metricas_tareas.purgar_metricas_y_actividad" in celery_app.tasks


def test_purga_borra_instantaneas_de_mas_de_7_dias_y_conserva_el_resto(db_session):
    db_session.add_all([
        MetricaInstantanea(capturada_en=AHORA - timedelta(days=7, seconds=1)),
        MetricaInstantanea(capturada_en=AHORA - timedelta(days=6, hours=23)),
        MetricaInstantanea(capturada_en=AHORA),
    ])
    db_session.flush()

    borradas, _ = cm.purgar(db_session, AHORA)

    assert borradas == 1
    restantes = db_session.scalars(select(MetricaInstantanea.capturada_en).order_by(MetricaInstantanea.capturada_en)).all()
    assert restantes == [AHORA - timedelta(days=6, hours=23), AHORA]


def test_purga_borra_actividad_de_mas_de_35_dias_y_conserva_30(db_session):
    usuario = crear_usuario_auth(db_session)
    hoy_club = date(2026, 10, 1)
    for dias in (36, 35, 30, 0):
        db_session.add(ActividadUsuario(usuario_id=usuario.id, fecha=hoy_club - timedelta(days=dias), franja=3))
    db_session.flush()

    _, borradas = cm.purgar(db_session, AHORA)

    assert borradas == 1  # solo la de 36 días
    fechas = db_session.scalars(select(ActividadUsuario.fecha).order_by(ActividadUsuario.fecha)).all()
    assert fechas == [hoy_club - timedelta(days=35), hoy_club - timedelta(days=30), hoy_club]


def test_la_tarea_de_purga_confirma_y_devuelve_los_conteos(db_session, monkeypatch):
    class Contexto:
        def __enter__(self):
            return db_session

        def __exit__(self, *_):
            return False

    monkeypatch.setattr(metricas_tareas, "SessionLocal", lambda: Contexto())
    db_session.add(MetricaInstantanea(capturada_en=datetime.now(timezone.utc) - timedelta(days=8)))
    db_session.flush()

    assert metricas_tareas.purgar_metricas_y_actividad() == {"instantaneas": 1, "actividad": 0}


def test_la_tarea_de_captura_no_lanza_si_el_scrape_falla(db_session, monkeypatch):
    class Contexto:
        def __enter__(self):
            return db_session

        def __exit__(self, *_):
            return False

    monkeypatch.setattr(metricas_tareas, "SessionLocal", lambda: Contexto())
    monkeypatch.setattr(cm, "scrapear_metricas", lambda: (_ for _ in ()).throw(OSError("caído")))

    assert metricas_tareas.capturar_metricas() is False
