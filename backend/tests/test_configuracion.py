"""
Endurecimiento de configuración (PR-10b).

Dos contratos:

1. La documentación interactiva (`/docs`, `/redoc`, `/openapi.json`) solo se
   publica FUERA de producción. En `development` y `test` sigue encendida a
   propósito (es útil para demos y para explorar la API a mano).
2. Los ajustes que en producción NO pueden quedarse con el default de
   desarrollo fallan al arrancar, con un mensaje que dice qué falta. La
   estrictez está condicionada a `AMBIENTE=production`: en `development` y
   `test` un `.env` incompleto NO puede tumbar el arranque.
"""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.soporte_transversal.configuracion import Settings, urls_documentacion
from main import app

_SECRETO_VALIDO = "clave_de_pruebas_larga_y_aleatoria_para_configuracion"


def _construir(**overrides) -> Settings:
    """Settings aislado del `.env` del repo y de las env vars del proceso
    para los campos que la prueba fija explícitamente."""
    base = {
        "_env_file": None,
        "jwt_secret_key": _SECRETO_VALIDO,
        "database_url": "postgresql+psycopg://real:real@db.produccion:5432/cataclub",
        "cors_origenes_raw": "https://cataclub.com",
    }
    base.update(overrides)
    return Settings(**base)


# --- 1. Documentación interactiva ------------------------------------------
def test_produccion_apaga_docs_redoc_y_openapi():
    assert urls_documentacion("production") == {
        "docs_url": None, "redoc_url": None, "openapi_url": None,
    }


def test_desarrollo_mantiene_docs_encendidas():
    assert urls_documentacion("development") == {
        "docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json",
    }


def test_ambiente_test_mantiene_docs_encendidas():
    """La suite corre con AMBIENTE=test: apagarlas acá escondería la
    regresión de haber apagado también las de desarrollo."""
    assert urls_documentacion("test")["docs_url"] == "/docs"


def test_openapi_sigue_sirviendose_en_la_app_de_pruebas():
    """Verificación de extremo a extremo del punto anterior sobre la `app`
    real de `main.py` (que se construye con AMBIENTE=test)."""
    with TestClient(app) as cliente:
        respuesta = cliente.get("/openapi.json")
    assert respuesta.status_code == 200


# --- 2. Fail-fast solo en producción ---------------------------------------
def test_produccion_rechaza_la_database_url_de_ejemplo():
    with pytest.raises(ValidationError) as error:
        _construir(
            ambiente="production",
            database_url="postgresql+psycopg://usuario:password@localhost:5432/cataclub_db",
        )
    assert "DATABASE_URL" in str(error.value)


def test_produccion_rechaza_cors_origenes_vacio():
    with pytest.raises(ValidationError) as error:
        _construir(ambiente="production", cors_origenes_raw="")
    assert "CORS_ORIGENES" in str(error.value)


def test_produccion_acepta_una_configuracion_completa():
    ajustes = _construir(ambiente="production")
    assert ajustes.cors_origenes == ["https://cataclub.com"]


@pytest.mark.parametrize("ambiente", ["development", "test"])
def test_fuera_de_produccion_los_defaults_de_desarrollo_no_tumban_el_arranque(ambiente):
    """Guardia anti-regresión del riesgo principal de este cambio: un clon
    nuevo, sin `DATABASE_URL` ni `CORS_ORIGENES` en su `.env`, tiene que
    seguir arrancando en desarrollo."""
    ajustes = Settings(
        _env_file=None, ambiente=ambiente, jwt_secret_key=_SECRETO_VALIDO,
        cors_origenes_raw="",
    )
    assert ajustes.ambiente == ambiente
    assert ajustes.cors_origenes == []
