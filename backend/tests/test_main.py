"""
Tests a nivel de aplicación (`main.py`): endpoint de salud y middleware de
cabeceras de seguridad (sdd/production-readiness, PR-09/PR-10).
"""
from fastapi.testclient import TestClient

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
