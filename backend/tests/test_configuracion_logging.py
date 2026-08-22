"""Configuración de logging del backend (issue #554).

Contrato: sin esta configuración, uvicorn arranca sin `--log-config`, el
logger raíz queda sin handlers y todo INFO/DEBUG de `cataclub.*` desaparece
por `logging.lastResort`. `configurar_logging()` instala UN handler a stdout
sobre el logger raíz, con timestamp, nivel, nombre del logger y `request_id`
(con default "-" cuando el registro no lo trae), al nivel que fija el ajuste
`LOG_LEVEL`.
"""
import logging
import re

import pytest
from pydantic import ValidationError

from app.soporte_transversal.configuracion import Settings
from app.soporte_transversal.configuracion_logging import configurar_logging

_SECRETO_VALIDO = "clave_de_pruebas_larga_y_aleatoria_para_logging_554"

# `%(asctime)s` con el formato default de logging: "2026-08-21 10:32:01,123".
_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")


def _construir_settings(**overrides) -> Settings:
    """Settings aislado del `.env` del repo; `ambiente=test` para no disparar
    el fail-fast de producción (irrelevante para estas pruebas)."""
    base = {
        "_env_file": None,
        "ambiente": "test",
        "jwt_secret_key": _SECRETO_VALIDO,
    }
    base.update(overrides)
    return Settings(**base)


# --- 1. Un INFO de `cataclub.*` llega a stdout con el formato completo ------
def test_info_de_cataclub_llega_a_stdout_formateado(capsys):
    # `forzar=True`: el guard de idempotencia ya corrió al importar main en
    # otras pruebas, y el handler viejo apunta al stdout REAL, no al que
    # capsys sustituye durante esta prueba.
    configurar_logging("INFO", forzar=True)

    logging.getLogger("cataclub.prueba").info(
        "membresia vencida", extra={"request_id": "req-554-abc"}
    )

    salida = capsys.readouterr().out
    assert "membresia vencida" in salida
    assert "INFO" in salida
    assert "cataclub.prueba" in salida
    assert "req-554-abc" in salida
    assert _TIMESTAMP.search(salida), f"sin timestamp: {salida!r}"


def test_debug_por_debajo_del_nivel_configurado_no_sale(capsys):
    configurar_logging("INFO", forzar=True)

    logging.getLogger("cataclub.prueba").debug("no deberia verse")

    assert "no deberia verse" not in capsys.readouterr().out


# --- 2. Un registro SIN request_id formatea igual, con el default "-" -------
def test_registro_sin_request_id_no_rompe_y_usa_guion(capsys):
    configurar_logging("INFO", forzar=True)

    logging.getLogger("cataclub.prueba").info("sin correlacion")

    salida = capsys.readouterr().out
    assert "sin correlacion" in salida
    assert "request_id=-" in salida


# --- 3. El ajuste LOG_LEVEL se valida contra los niveles reales -------------
def test_log_level_default_es_info():
    assert _construir_settings().log_level == "INFO"


@pytest.mark.parametrize("nivel", ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])
def test_log_level_acepta_los_niveles_estandar(nivel):
    assert _construir_settings(log_level=nivel).log_level == nivel


def test_log_level_normaliza_minusculas():
    """`LOG_LEVEL=debug` en un .env escrito a mano tiene que funcionar."""
    assert _construir_settings(log_level="debug").log_level == "DEBUG"


def test_log_level_invalido_falla_al_arrancar():
    with pytest.raises(ValidationError) as error:
        _construir_settings(log_level="VERBOSE")
    assert "LOG_LEVEL" in str(error.value)


# --- 4. Idempotencia: configurar dos veces no duplica handlers --------------
def test_configurar_dos_veces_no_duplica_handlers():
    configurar_logging("INFO", forzar=True)
    cantidad = len(logging.getLogger().handlers)

    configurar_logging("INFO")  # segunda llamada, sin forzar

    assert len(logging.getLogger().handlers) == cantidad


def test_forzar_tampoco_duplica_handlers():
    """dictConfig REEMPLAZA los handlers del raíz: ni siquiera un re-arranque
    forzado (el caso de las pruebas) puede acumularlos."""
    configurar_logging("INFO", forzar=True)
    cantidad = len(logging.getLogger().handlers)

    configurar_logging("INFO", forzar=True)

    assert len(logging.getLogger().handlers) == cantidad
