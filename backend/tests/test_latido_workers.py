"""Latido de Celery para el monitor externo (PC-2).

El beat despacha `registrar_latido` cada minuto y el worker lo ejecuta y
escribe una clave en Redis con TTL corto. `/health/workers` solo mira si esa
clave existe: beat, worker o broker caídos hacen que expire y la sonda dé 503.
"""
from celery.schedules import crontab
from fastapi.testclient import TestClient

import main
from app.infraestructura import latido_workers
from app.infraestructura.tareas import latido_tareas
from app.infraestructura.tareas.celery_app import celery_app
from main import app


class _RedisFalso:
    def __init__(self):
        self.datos = {}
        self.ttls = {}

    def set(self, clave, valor, ex=None):
        self.datos[clave] = valor
        self.ttls[clave] = ex

    def get(self, clave):
        return self.datos.get(clave)

    def expirar(self, clave):
        self.datos.pop(clave, None)


def test_el_beat_programa_el_latido_cada_minuto_con_expiracion():
    entrada = celery_app.conf.beat_schedule["registrar-latido-workers-cada-minuto"]

    assert entrada["task"] == "app.infraestructura.tareas.latido_tareas.registrar_latido"
    assert entrada["schedule"] == crontab(minute="*/1")
    # Un latido que esperó en la cola más que el TTL ya no prueba nada.
    assert 0 < entrada["options"]["expires"] <= latido_workers.TTL_SEGUNDOS


def test_el_ttl_cubre_al_menos_dos_latidos_perdidos():
    assert latido_workers.TTL_SEGUNDOS >= 3 * 60


def test_registrar_escribe_la_clave_con_ttl():
    redis_falso = _RedisFalso()

    latido_workers.registrar(redis_falso)

    assert latido_workers.CLAVE in redis_falso.datos
    assert redis_falso.ttls[latido_workers.CLAVE] == latido_workers.TTL_SEGUNDOS


def test_la_tarea_registra_el_latido(monkeypatch):
    redis_falso = _RedisFalso()
    monkeypatch.setattr(latido_tareas, "_cliente_redis", lambda: redis_falso)

    assert latido_tareas.registrar_latido() is True
    assert latido_workers.CLAVE in redis_falso.datos


def test_vivo_depende_de_la_clave():
    redis_falso = _RedisFalso()
    assert latido_workers.vivo(redis_falso) is False
    latido_workers.registrar(redis_falso)
    assert latido_workers.vivo(redis_falso) is True
    redis_falso.expirar(latido_workers.CLAVE)
    assert latido_workers.vivo(redis_falso) is False


def test_vivo_trata_redis_caido_como_muerto():
    class _Roto:
        def get(self, clave):
            raise ConnectionError("redis caído")

    assert latido_workers.vivo(_Roto()) is False


def _consultar(monkeypatch, redis_falso, metodo):
    monkeypatch.setattr(main, "_cliente_redis_sonda", redis_falso)
    with TestClient(app) as cliente:
        return getattr(cliente, metodo)("/health/workers")


def test_health_workers_200_sin_cuerpo_cuando_el_latido_es_fresco(monkeypatch):
    redis_falso = _RedisFalso()
    latido_workers.registrar(redis_falso)

    for metodo in ("get", "head"):
        respuesta = _consultar(monkeypatch, redis_falso, metodo)
        assert respuesta.status_code == 200
        assert respuesta.content == b""


def test_health_workers_503_sin_cuerpo_cuando_el_latido_expiro(monkeypatch):
    for metodo in ("get", "head"):
        respuesta = _consultar(monkeypatch, _RedisFalso(), metodo)
        assert respuesta.status_code == 503
        assert respuesta.content == b""


def test_health_workers_503_sin_detalle_cuando_redis_falla(monkeypatch):
    class _Roto:
        def get(self, clave):
            raise ConnectionError("redis caído")

    respuesta = _consultar(monkeypatch, _Roto(), "get")

    assert respuesta.status_code == 503
    assert respuesta.content == b""


def test_health_workers_no_declara_dependencias_ni_va_al_esquema():
    rutas = [r for r in app.routes if getattr(r, "path", None) == "/health/workers"]

    assert {m for r in rutas for m in r.methods} == {"GET", "HEAD"}
    for ruta in rutas:
        assert ruta.dependant.dependencies == []
        assert ruta.include_in_schema is False
