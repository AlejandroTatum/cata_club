"""Salud del sistema (QA4 ADMB-N1): el latido de los workers alimenta lo que
sirven `/actividad/resumen` y `/actividad/avanzadas`."""
from datetime import timedelta

import pytest

from app.dominio.modelos import MetricaInstantanea
from app.infraestructura import latido_workers
from app.presentacion.routers import actividad_router
from app.servicios_negocio import salud_sistema
from tests import actividad_fabricas as fab

AHORA = fab.AHORA
RUTAS = ("/api/v1/actividad/resumen?rango=7d", "/api/v1/actividad/avanzadas?rango=1h")


class _Redis:
    def __init__(self, valor=None, falla=False):
        self.valor, self.falla = valor, falla

    def get(self, clave):
        if self.falla:
            raise ConnectionError("redis caído")
        return self.valor


def _latido(hace_s):
    return (AHORA - timedelta(seconds=hace_s)).isoformat()


def _componentes(salud):
    return {c.key: c.reason for c in salud.components}


# --- evaluar (función pura) ----------------------------------------------------
def test_latido_fresco_es_ok():
    salud = salud_sistema.evaluar(edad_latido_s=30, outbox_mas_antiguo_s=0)

    assert salud.state == "ok" and salud.degraded is False
    assert salud.components == []


def test_latido_justo_en_el_umbral_sigue_ok():
    assert salud_sistema.evaluar(salud_sistema.MAX_EDAD_LATIDO_S, None).state == "ok"


def test_latido_viejo_degrada_y_nombra_workers_correo_y_outbox():
    salud = salud_sistema.evaluar(salud_sistema.MAX_EDAD_LATIDO_S + 1, 0)

    assert salud.state == "degraded" and salud.degraded is True
    assert _componentes(salud) == {
        "workers": "heartbeat_stale", "email": "heartbeat_stale", "outbox": "heartbeat_stale",
    }


def test_latido_ausente_degrada_con_motivo_missing():
    salud = salud_sistema.evaluar(None, 0)

    assert salud.degraded is True
    assert set(_componentes(salud).values()) == {"heartbeat_missing"}


def test_outbox_atascado_degrada_solo_outbox_y_correo():
    salud = salud_sistema.evaluar(10, salud_sistema.MAX_EDAD_OUTBOX_S + 1)

    assert _componentes(salud) == {"email": "outbox_stale", "outbox": "outbox_stale"}


def test_outbox_vacio_o_desconocido_no_degrada():
    assert salud_sistema.evaluar(10, None).state == "ok"
    assert salud_sistema.evaluar(10, 0).state == "ok"


def test_edad_del_latido_lee_la_marca_de_redis():
    assert latido_workers.edad_segundos(_Redis(_latido(45)), AHORA) == pytest.approx(45)
    assert latido_workers.edad_segundos(_Redis(_latido(45).encode()), AHORA) == pytest.approx(45)


@pytest.mark.parametrize("cliente", [_Redis(None), _Redis("basura"), _Redis(falla=True)])
def test_edad_del_latido_es_none_si_falta_es_ilegible_o_redis_cae(cliente):
    assert latido_workers.edad_segundos(cliente, AHORA) is None


# --- endpoints ---------------------------------------------------------------------
@pytest.fixture
def redis_latido(monkeypatch):
    cliente = _Redis(_latido(20))
    monkeypatch.setattr(actividad_router, "_cliente_latido", lambda: cliente)
    monkeypatch.setattr(actividad_router, "_ahora", lambda: AHORA)
    return cliente


@pytest.mark.parametrize("ruta", RUTAS)
def test_endpoint_con_latido_fresco_reporta_ok(client, redis_latido, ruta):
    salud = client.get(ruta).json()["health"]

    assert salud == {"state": "ok", "degraded": False, "heartbeatAgeSeconds": 20, "components": []}


@pytest.mark.parametrize("ruta", RUTAS)
def test_endpoint_con_latido_viejo_reporta_degradado_y_nombra_componentes(client, redis_latido, ruta):
    redis_latido.valor = _latido(600)

    salud = client.get(ruta).json()["health"]

    assert salud["state"] == "degraded" and salud["degraded"] is True
    assert {c["key"] for c in salud["components"]} == {"workers", "email", "outbox"}


@pytest.mark.parametrize("ruta", RUTAS)
def test_endpoint_sin_latido_reporta_degradado(client, redis_latido, ruta):
    redis_latido.valor = None

    salud = client.get(ruta).json()["health"]

    assert salud["degraded"] is True and salud["heartbeatAgeSeconds"] is None
    assert {c["reason"] for c in salud["components"]} == {"heartbeat_missing"}


def test_resumen_ya_no_dice_todo_bien_si_el_correo_esta_caido(client, db_session, redis_latido):
    db_session.add(MetricaInstantanea(
        capturada_en=AHORA - timedelta(minutes=1), intervalo_s=60, peticiones=100, errores_5xx=0,
        errores_4xx=0, latencia_buckets=[0, 50, 90, 100] + [100] * 8, outbox_mas_antiguo_s=0,
        db_conexiones=10, db_conexiones_max=100,
    ))
    db_session.flush()
    redis_latido.valor = _latido(600)

    estado = {s["key"]: s["level"] for s in client.get(RUTAS[0]).json()["status"]}

    assert estado == {"app": "ok", "errors": "ok", "notifications": "bad"}


def test_outbox_atascado_en_instantanea_degrada_correo_y_outbox(client, db_session, redis_latido):
    db_session.add(MetricaInstantanea(
        capturada_en=AHORA - timedelta(minutes=1), intervalo_s=60, peticiones=1, errores_5xx=0,
        outbox_pendientes=3, outbox_mas_antiguo_s=salud_sistema.MAX_EDAD_OUTBOX_S + 60,
    ))
    db_session.flush()

    salud = client.get(RUTAS[1]).json()["health"]

    assert {c["key"] for c in salud["components"]} == {"email", "outbox"}
