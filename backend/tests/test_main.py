"""
Tests a nivel de aplicación (`main.py`): endpoint de salud, middleware de
cabeceras de seguridad (sdd/production-readiness, PR-09/PR-10), contrato de
traducción de `IntegrityError` no manejado (sdd/borde-http-observable, PR1) y
sonda de readiness `GET /health/ready` (sdd/borde-http-observable, PR2).
"""
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

import main
from main import app


# --- GET /health (PR-09) ----------------------------------------------------
# Existía ANTES de endurecer /docs (PR-10b): el healthcheck de
# docker-compose.yml ya migró de /docs a /health, así que apagar la
# documentación en producción no rompe el healthcheck del deploy.
def test_health_no_declara_ninguna_dependencia():
    """Guardia estructural: /health no debe depender de `obtener_sesion` ni
    de autenticación -- tiene que responder incluso si la BD está caída,
    porque es la sonda de liveness del contenedor backend."""
    ruta = next(r for r in app.routes if getattr(r, "path", None) == "/health")
    assert ruta.dependant.dependencies == []


def test_health_responde_200_sin_autenticacion_ni_overrides():
    """TestClient(app) crudo, sin ningún dependency_override de las fixtures
    de conftest.py: si /health dependiera de la BD o de un token, esta
    llamada fallaría distinto de un 200 limpio."""
    with TestClient(app) as cliente:
        respuesta = cliente.get("/health")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"estado": "ok"}


# --- Middleware de cabeceras de seguridad (PR-10) ---------------------------
def test_cabeceras_de_seguridad_presentes_en_respuesta_exitosa():
    with TestClient(app) as cliente:
        respuesta = cliente.get("/health")
    assert respuesta.headers["x-content-type-options"] == "nosniff"
    assert respuesta.headers["x-frame-options"] == "DENY"
    assert respuesta.headers["referrer-policy"] == "no-referrer"
    assert respuesta.headers["content-security-policy"] == (
        "default-src 'none'; frame-ancestors 'none'"
    )
    assert "max-age=" in respuesta.headers["strict-transport-security"]


def test_cabeceras_de_seguridad_presentes_incluso_en_respuesta_401(client_sin_token):
    """Prueba que el middleware queda MÁS AFUERA que CORS y que los
    manejadores de excepciones de dominio (main.py): Starlette antepone cada
    middleware nuevo, así que el último registrado envuelve a todos los
    demás -- incluida esta respuesta 401 de autenticación fallida."""
    respuesta = client_sin_token.get("/api/v1/geografia/paises")
    assert respuesta.status_code == 401
    assert respuesta.headers["x-content-type-options"] == "nosniff"
    assert respuesta.headers["content-security-policy"] == (
        "default-src 'none'; frame-ancestors 'none'"
    )


# --- Manejador global de IntegrityError (PR1, sdd/borde-http-observable) ----
_RUTA_DESCARTABLE = "/__prueba__/integrity-error"


@pytest.fixture()
def ruta_que_lanza_integrity_error():
    """Registra sobre `app.router` una ruta descartable que lanza
    `IntegrityError` a propósito, sin pasar por ningún camino de negocio
    conocido, para fijar por test el contrato observable del manejador global
    ya implementado en `main.py` (`_integrity_error_handler`).

    La restauración se hace por asignación de slice (`app.router.routes[:] =
    ...`), no por rebind: `app.routes` es una property que devuelve la MISMA
    lista que `app.router.routes`, así que un rebind rompería cualquier
    referencia ya capturada a esa lista. El `assert` final hace que la propia
    fixture se auto-verifique: si la limpieza falla, pytest reporta el error
    en este test en lugar de contaminar en silencio a los siguientes.
    """
    rutas_previas = list(app.router.routes)

    @app.get(_RUTA_DESCARTABLE, include_in_schema=False)
    async def _lanzar():
        raise IntegrityError("INSERT INTO tabla ...", {}, Exception("llave duplicada"))

    try:
        yield _RUTA_DESCARTABLE
    finally:
        app.router.routes[:] = rutas_previas
        app.openapi_schema = None
        assert all(getattr(r, "path", None) != _RUTA_DESCARTABLE for r in app.routes)


def test_integrity_error_no_manejado_responde_409_con_traceback(
    ruta_que_lanza_integrity_error, caplog, monkeypatch
):
    """Fija el contrato del manejador global ya implementado en `main.py`
    (`_integrity_error_handler`, líneas 89-95): un `IntegrityError` que llega
    sin traducir hasta la app responde 409 con cuerpo `{detail, message}` (el
    contrato de `_respuesta_error`) y queda registrado con traceback vía
    `_log.exception`, sin silenciarse.

    Nota: `esquema_migrado` (conftest, autouse/session) corre Alembic, que
    aplica `fileConfig(alembic.ini)` con `disable_existing_loggers=True` --
    eso deshabilita el logger `main` ya instanciado al momento de recolectar
    los tests. Se reactiva explícitamente acá, mismo precedente que
    `test_cloudinary_cliente.py` (comentario junto a
    `test_subida_lenta_emite_warning_en_vez_de_info`): no es parte del
    comportamiento bajo prueba, es un efecto de sesión de la suite."""
    monkeypatch.setattr(logging.getLogger("main"), "disabled", False)

    with caplog.at_level(logging.ERROR, logger="main"):
        with TestClient(app) as cliente:
            respuesta = cliente.get(ruta_que_lanza_integrity_error)

    assert respuesta.status_code == 409

    cuerpo = respuesta.json()
    assert cuerpo["detail"]
    assert cuerpo["message"]
    assert cuerpo["detail"] == cuerpo["message"]

    registros = [r for r in caplog.records if r.name == "main"]
    assert registros, "se esperaba al menos un registro del logger 'main'"
    assert registros[-1].exc_info is not None


# --- GET /health/ready: sonda de readiness (PR2, sdd/borde-http-observable) --
# Postgres es real en la suite (Postgres de test vía TEST_DATABASE_URL), pero
# ambos chequeos se mockean acá: el objetivo de estos tests es el
# comportamiento del endpoint (agregación, código de estado, forma del
# cuerpo), no el driver. Redis en particular NUNCA se conecta de verdad --
# `conftest.py` no lo levanta ni en local ni en CI (mismo precedente que
# `_mock_disparo_celery_comprobante`, líneas 114-120 de este archivo).
def test_health_ready_no_declara_ninguna_dependencia():
    """Guardia estructural, espejo de `test_health_no_declara_ninguna_
    dependencia`: /health/ready tampoco depende de `obtener_sesion` ni de
    autenticación -- las verificaciones de Postgres/Redis las hace el propio
    endpoint con clientes de sonda dedicados, no vía `Depends`."""
    ruta = next(r for r in app.routes if getattr(r, "path", None) == "/health/ready")
    assert ruta.dependant.dependencies == []


def test_health_ready_responde_200_cuando_ambas_dependencias_estan_sanas(monkeypatch):
    monkeypatch.setattr(main, "_verificar_postgres", lambda: True)
    monkeypatch.setattr(main, "_verificar_redis", lambda: True)

    with TestClient(app) as cliente:
        respuesta = cliente.get("/health/ready")

    assert respuesta.status_code == 200
    assert respuesta.json() == {"estado": "listo", "postgres": "ok", "redis": "ok"}


def test_health_ready_responde_sin_autenticacion_ni_overrides(client_sin_token, monkeypatch):
    """Igual que `test_health_responde_200_sin_autenticacion_ni_overrides`
    para /health: sin token no debe rechazarse con 401 ni 403, porque es una
    sonda sin `Depends` de autenticación."""
    monkeypatch.setattr(main, "_verificar_postgres", lambda: True)
    monkeypatch.setattr(main, "_verificar_redis", lambda: True)

    respuesta = client_sin_token.get("/health/ready")

    assert respuesta.status_code not in (401, 403)


def test_health_ready_responde_503_cuando_postgres_esta_caida(monkeypatch):
    monkeypatch.setattr(main, "_verificar_postgres", lambda: False)
    monkeypatch.setattr(main, "_verificar_redis", lambda: True)

    with TestClient(app) as cliente:
        respuesta = cliente.get("/health/ready")

    assert respuesta.status_code == 503
    cuerpo = respuesta.json()
    assert cuerpo["detail"]
    assert cuerpo["message"]


def test_health_ready_responde_503_cuando_redis_esta_caida(monkeypatch):
    monkeypatch.setattr(main, "_verificar_postgres", lambda: True)
    monkeypatch.setattr(main, "_verificar_redis", lambda: False)

    with TestClient(app) as cliente:
        respuesta = cliente.get("/health/ready")

    assert respuesta.status_code == 503
    cuerpo = respuesta.json()
    assert cuerpo["detail"]
    assert cuerpo["message"]


def test_health_ready_responde_503_cuando_ambas_dependencias_estan_caidas(monkeypatch):
    monkeypatch.setattr(main, "_verificar_postgres", lambda: False)
    monkeypatch.setattr(main, "_verificar_redis", lambda: False)

    with TestClient(app) as cliente:
        respuesta = cliente.get("/health/ready")

    assert respuesta.status_code == 503
    cuerpo = respuesta.json()
    assert cuerpo["detail"]
    assert cuerpo["message"]


def test_health_ready_excepcion_inesperada_en_verificacion_de_postgres_no_produce_500(
    monkeypatch,
):
    """Segunda capa de defensa (D5): aunque `_verificar_postgres` ya captura
    excepciones internamente y nunca debería levantar, este test verifica que
    si lo hiciera de todos modos -- por ejemplo por un bug de un refactor
    futuro -- el endpoint sigue respondiendo 503 y no un 500 sin manejar,
    gracias a `gather(..., return_exceptions=True)` y a la normalización
    `resultado is True`."""

    def _levanta():
        raise RuntimeError("fallo arbitrario simulando un bug del verificador")

    monkeypatch.setattr(main, "_verificar_postgres", _levanta)
    monkeypatch.setattr(main, "_verificar_redis", lambda: True)

    with TestClient(app) as cliente:
        respuesta = cliente.get("/health/ready")

    assert respuesta.status_code == 503


def test_health_ready_excepcion_inesperada_en_verificacion_de_redis_no_produce_500(
    monkeypatch,
):
    def _levanta():
        raise RuntimeError("fallo arbitrario simulando un bug del verificador")

    monkeypatch.setattr(main, "_verificar_postgres", lambda: True)
    monkeypatch.setattr(main, "_verificar_redis", _levanta)

    with TestClient(app) as cliente:
        respuesta = cliente.get("/health/ready")

    assert respuesta.status_code == 503


def test_verificar_postgres_ante_timeout_devuelve_false_sin_colgar(monkeypatch):
    """Un timeout de conexión o de sentencia (`connect_timeout`/
    `statement_timeout`, D3) llega como una excepción de SQLAlchemy/psycopg
    normal -- `_verificar_postgres` la captura con `except Exception` y
    devuelve `False`, en vez de dejarla escapar o quedarse colgado."""
    from sqlalchemy.exc import OperationalError

    def _conexion_agotada(*args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("timeout expired"))

    monkeypatch.setattr(main._motor_sonda, "connect", _conexion_agotada)

    assert main._verificar_postgres() is False


def test_verificar_redis_ante_timeout_devuelve_false_sin_colgar(monkeypatch):
    """Análogo a `test_verificar_postgres_ante_timeout_devuelve_false_sin_
    colgar` para Redis: `socket_connect_timeout`/`socket_timeout` (D4) hacen
    que el driver levante `redis.exceptions.TimeoutError`, que
    `_verificar_redis` captura y traduce a `False`."""
    import redis

    def _ping_agotado(*args, **kwargs):
        raise redis.exceptions.TimeoutError("Timeout reading from socket")

    monkeypatch.setattr(main._cliente_redis_sonda, "ping", _ping_agotado)

    assert main._verificar_redis() is False
