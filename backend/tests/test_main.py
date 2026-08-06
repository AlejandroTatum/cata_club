"""
Tests a nivel de aplicación (`main.py`): endpoint de salud, middleware de
cabeceras de seguridad (sdd/production-readiness, PR-09/PR-10), contrato de
traducción de `IntegrityError` no manejado (sdd/borde-http-observable, PR1),
sonda de readiness `GET /health/ready` (sdd/borde-http-observable, PR2) y
middleware de correlación `X-Request-ID` (sdd/borde-http-observable, PR3).
"""
import logging
import uuid

import pytest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

import main
from app.soporte_transversal.configuracion import settings
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


def test_integrity_error_loguea_el_request_id_de_correlacion(
    ruta_que_lanza_integrity_error, caplog, monkeypatch
):
    """Complementa `test_integrity_error_no_manejado_responde_409_con_
    traceback`: aquel test sólo fija que hay traceback (`exc_info`), pero
    ninguno verifica el CONTENIDO del mensaje, en particular el
    `[request_id=%s]` que interpola `getattr(request.state, "request_id",
    "-")` (`main.py`, `_integrity_error_handler`). Si un upgrade de
    Starlette rompiera la propagación de `request.state` entre
    `_CorrelacionDeRequestMiddleware` y el manejador de excepción, el
    interpolado caería en silencio al fallback `"-"` y ningún test
    existente lo detectaría: éste es exactamente el que lo hace, mandando
    un `X-Request-ID` conocido y válido y verificando que aparece tal cual
    en el mensaje logueado. Es la prueba de punta a punta de que la
    correlación efectivamente llega hasta el log, que es toda la razón de
    ser de la pieza.

    Mismo gotcha heredado que el test del 409: Alembic deja el logger
    'main' deshabilitado (`disable_existing_loggers=True` en
    `esquema_migrado`), así que hay que reactivarlo antes de `caplog`."""
    monkeypatch.setattr(logging.getLogger("main"), "disabled", False)
    id_de_correlacion = "id-de-correlacion-conocido-para-el-test"

    with caplog.at_level(logging.ERROR, logger="main"):
        with TestClient(app) as cliente:
            cliente.get(
                ruta_que_lanza_integrity_error,
                headers={"X-Request-ID": id_de_correlacion},
            )

    registros = [r for r in caplog.records if r.name == "main"]
    assert registros, "se esperaba al menos un registro del logger 'main'"
    mensaje = registros[-1].getMessage()
    assert f"[request_id={id_de_correlacion}]" in mensaje


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


def test_verificar_postgres_camino_de_exito_real_sin_mockear():
    """Todos los tests de arriba mockean `_verificar_postgres` entera (a
    nivel de endpoint) o parchean `_motor_sonda.connect` para forzar una
    excepción: ninguno deja correr la función real hasta su `return True`.
    Eso deja sin ejercitar los `connect_args` nuevos (`connect_timeout` y
    `options=-c statement_timeout=...`, D3) y la ejecución real del
    `SELECT 1` contra un Postgres de verdad.

    Este test SÍ deja correr `main._verificar_postgres()` sin mockear nada:
    `conftest.py` fija `os.environ["DATABASE_URL"] = TEST_DATABASE_URL`
    ANTES de importar `main` (ver conftest.py, líneas 53-68), así que
    `main._motor_sonda` -- construido con `settings.database_url` -- apunta
    al mismo Postgres de test que usa el resto de la suite (el `db-test` de
    docker-compose, real). Que esta llamada devuelva `True` prueba de una
    que: (a) el motor de sonda se construyó correctamente, (b) el driver
    psycopg acepta los `connect_args` tal como están escritos -- un typo en
    la clave `options` o un valor inválido de `statement_timeout` haría
    fallar la conexión en vez de sólo el timeout --, y (c) el `SELECT 1`
    corre y devuelve una fila."""
    assert main._verificar_postgres() is True


def test_verificar_redis_camino_de_exito_ejercita_el_cuerpo_real(monkeypatch):
    """Análogo a `test_verificar_postgres_camino_de_exito_real_sin_
    mockear`, pero para Redis: no hay Redis real disponible en el entorno
    de test (ni local ni en CI, ver comentario de la sección de arriba), así
    que a diferencia de Postgres no se puede dejar correr la función contra
    un servidor de verdad. Lo que SÍ se puede -- y hoy no se hace en ningún
    test -- es parchear únicamente `.ping` en el cliente singleton
    (`main._cliente_redis_sonda`) en vez de mockear `_verificar_redis`
    entera: eso ejercita el `bool(...)` y el `return` reales de la función,
    que hoy sólo se prueban indirectamente vía los tests de
    `/health/ready` que mockean la función completa.

    Lo que este test NO cubre, a propósito, y que sólo un Redis real
    probaría: el round-trip de red efectivo, y que `socket_connect_timeout`
    / `socket_timeout` (D4) se apliquen de verdad a nivel de socket -- eso
    ya está cubierto en el caso de fallo por
    `test_verificar_redis_ante_timeout_devuelve_false_sin_colgar`, que sí
    parchea `.ping` para levantar la excepción de timeout real del driver."""
    monkeypatch.setattr(main._cliente_redis_sonda, "ping", lambda: True)

    assert main._verificar_redis() is True


# --- Middleware de correlación X-Request-ID (PR3, sdd/borde-http-observable) -
# `_CorrelacionDeRequestMiddleware` se registra entre `CORSMiddleware` y
# `_CabecerasDeSeguridadMiddleware` (D6/D7 del diseño): toda respuesta debe
# llevar `X-Request-ID`, respetando el valor entrante cuando es válido y
# generando uno nuevo con `uuid4()` en caso contrario, sin desplazar a
# Cabeceras del puesto más externo de la pila.
def test_x_request_id_presente_en_respuesta_exitosa():
    """Toda respuesta exitosa lleva el header `X-Request-ID` con un valor no
    vacío, aunque el cliente no haya enviado ninguno."""
    with TestClient(app) as cliente:
        respuesta = cliente.get("/health")
    assert respuesta.headers["x-request-id"]


def test_x_request_id_entrante_valido_se_respeta():
    """Si el cliente manda un `X-Request-ID` que valida contra el formato
    aceptado, el servidor lo propaga tal cual en la respuesta, sin
    reemplazarlo por uno generado."""
    id_entrante = "3f8f1c2a-6b7d-4e9a-9c1a-1234567890ab"
    with TestClient(app) as cliente:
        respuesta = cliente.get("/health", headers={"X-Request-ID": id_entrante})
    assert respuesta.headers["x-request-id"] == id_entrante


@pytest.mark.parametrize(
    "valor_entrante",
    ["", "<script>alert(1)</script>", "a" * 300, "a" * 129],
    ids=[
        "cadena-vacia",
        "caracteres-no-permitidos",
        "excesivamente-largo",
        "un-caracter-por-encima-del-limite",
    ],
)
def test_x_request_id_entrante_invalido_se_descarta_y_se_genera_uno_nuevo(valor_entrante):
    """Un `X-Request-ID` entrante que no valida (vacío, con caracteres fuera
    de la lista blanca, o excesivamente largo) NUNCA se refleja tal cual: un
    id que viaja a los logs es superficie de inyección, así que no se confía
    en el cliente. Se descarta y se genera un UUID nuevo del lado del
    servidor en su lugar.

    El caso `un-caracter-por-encima-del-limite` (129 caracteres) es el borde
    exacto de `_FORMATO_REQUEST_ID` (`{1,128}`), complementario de
    `test_x_request_id_entrante_de_exactamente_128_caracteres_se_respeta`
    de más abajo: los casos previos (300 caracteres) están muy por encima
    del límite y no detectarían un off-by-one en el cuantificador."""
    with TestClient(app) as cliente:
        respuesta = cliente.get("/health", headers={"X-Request-ID": valor_entrante})
    nuevo_id = respuesta.headers["x-request-id"]
    assert nuevo_id != valor_entrante
    uuid.UUID(nuevo_id)  # levanta ValueError si no es un UUID válido


def test_x_request_id_entrante_de_exactamente_128_caracteres_se_respeta():
    """Borde exacto de `_FORMATO_REQUEST_ID` (`{1,128}`), complementario del
    caso `un-caracter-por-encima-del-limite` del test parametrizado de
    arriba: una cadena de EXACTAMENTE 128 caracteres de la lista blanca es
    un `X-Request-ID` válido y se respeta tal cual, igual que
    `test_x_request_id_entrante_valido_se_respeta`. Ningún test existente
    prueba el límite exacto -- el parametrizado cubre 300 caracteres,
    claramente por encima --, así que un off-by-one en el cuantificador
    (por ejemplo `{1,127}`) pasaría desapercibido sin este caso."""
    id_valido_de_128_caracteres = "a" * 128
    with TestClient(app) as cliente:
        respuesta = cliente.get(
            "/health", headers={"X-Request-ID": id_valido_de_128_caracteres}
        )
    assert respuesta.headers["x-request-id"] == id_valido_de_128_caracteres


@pytest.fixture()
def origen_cors_configurado():
    """`settings.cors_origenes[0]` asume una lista no vacía, pero
    `test_configuracion.py::test_fuera_de_produccion_los_defaults_de_
    desarrollo_no_tumban_el_arranque` demuestra que con `ambiente="test"` y
    `CORS_ORIGENES` vacío, `cors_origenes == []` es un estado soportado que
    no rompe el arranque. Si el entorno de esta suite llegara a esa
    configuración, los
    dos tests de preflight de abajo fallarían con un `IndexError` críptico
    en el momento del `[0]`, en vez de un motivo legible.

    Se elige `pytest.skip` en vez de una fixture que devuelva un valor
    hardcodeado (por ejemplo `"http://localhost:3000"`): un origen inventado
    probaría el comportamiento de CORS contra un valor que puede no
    coincidir con la configuración real del entorno, lo cual sería un falso
    positivo más engañoso que un `skip` explícito. `pytest.skip` dejando el
    motivo por escrito es preferible: la ausencia de cobertura queda
    documentada en el reporte de la suite en vez de aparecer como un
    `IndexError` sin contexto, y no se toca `conftest.py` ni la
    configuración para forzar un origen que hoy no es responsabilidad de
    este archivo."""
    origenes = settings.cors_origenes
    if not origenes:
        pytest.skip(
            "settings.cors_origenes está vacío en este entorno (CORS_ORIGENES "
            "sin definir con ambiente=test): no hay un origen real disponible "
            "contra el cual probar el preflight de CORS."
        )
    return origenes[0]


def test_x_request_id_presente_en_preflight_options_cortocircuito_por_cors(
    origen_cors_configurado,
):
    """Un preflight OPTIONS con `Origin` + `Access-Control-Request-Method`
    coincidentes con un origen permitido lo resuelve `CORSMiddleware` en
    corto-circuito, sin invocar `call_next` hacia el router. Igual debe
    llevar `X-Request-ID`: prueba de que Correlación queda POR FUERA de CORS
    en la pila (D6), así que el camino corto de CORS no se lo pierde."""
    origen = origen_cors_configurado
    with TestClient(app) as cliente:
        respuesta = cliente.options(
            "/health",
            headers={
                "Origin": origen,
                "Access-Control-Request-Method": "GET",
            },
        )
    assert respuesta.status_code == 200
    assert respuesta.headers["x-request-id"]


def test_cabeceras_de_seguridad_presentes_en_preflight_options_cortocircuito_por_cors(
    origen_cors_configurado,
):
    """Complementa el test anterior: las 5 cabeceras de seguridad también
    sobreviven al camino corto de CORS, prueba de que Cabeceras sigue siendo
    la más externa de la pila incluso sobre una respuesta que CORS resuelve
    sin llegar al router."""
    origen = origen_cors_configurado
    with TestClient(app) as cliente:
        respuesta = cliente.options(
            "/health",
            headers={
                "Origin": origen,
                "Access-Control-Request-Method": "GET",
            },
        )
    assert respuesta.headers["x-content-type-options"] == "nosniff"
    assert respuesta.headers["content-security-policy"] == (
        "default-src 'none'; frame-ancestors 'none'"
    )


def test_x_request_id_presente_en_respuesta_de_error_de_autenticacion(client_sin_token):
    """Un 401 de autenticación fallida también lleva `X-Request-ID`: prueba
    de que Correlación, igual que Cabeceras, post-procesa TODAS las
    respuestas, incluidas las de error."""
    respuesta = client_sin_token.get("/api/v1/geografia/paises")
    assert respuesta.status_code == 401
    assert respuesta.headers["x-request-id"]


def test_orden_de_la_pila_de_middleware_es_el_declarado():
    """Guardián de pila (D6): `app.user_middleware[0]` es el middleware MÁS
    EXTERNO -- `add_middleware` de Starlette antepone cada registro nuevo, así
    que el ÚLTIMO en registrarse queda más afuera. Esta igualdad de lista
    COMPLETA (no una comprobación de presencia ni de índice aislado) protege
    la invariante de que `_CabecerasDeSeguridadMiddleware` sigue siendo el más
    externo, con `_CorrelacionDeRequestMiddleware` en el medio y
    `CORSMiddleware` más adentro, pegado al router: cualquier reordenamiento
    accidental, o la inserción de un middleware nuevo en cualquier punto de la
    pila, hace fallar este test aunque el resto de la suite siga en verde."""
    assert [m.cls for m in app.user_middleware] == [
        main._CabecerasDeSeguridadMiddleware,
        main._CorrelacionDeRequestMiddleware,
        CORSMiddleware,
    ]
