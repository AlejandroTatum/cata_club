"""
Tests de `cloudinary_cliente.py`: `_subir()` es el ÚNICO punto donde el
módulo llama a `cloudinary.uploader.upload`. Estos tests cubren su contrato
de timeout, su traducción de fallos del vendor y la ausencia total de
reintento dentro del módulo.

Ningún test toca la red: se parchea `cloudinary.uploader.upload` (mismo
criterio que `test_notificaciones.py:16` para `smtplib.SMTP`) — probar que un
socket realmente expira sería probar una dependencia, no nuestro código.
"""
import inspect
import logging
import re
from unittest.mock import patch

import pytest
from urllib3.util import Timeout

import app.infraestructura.cloudinary_cliente as cc
from app.dominio.excepciones import ServicioNoDisponible
from app.soporte_transversal.resiliencia import CIRCUITO_CLOUDINARY_UMBRAL_FALLOS


def _subir_pdf(**overrides):
    kwargs = dict(contenido_pdf=b"contenido-pdf", nombre_publico="pdf-1")
    kwargs.update(overrides)
    return cc.subir_pdf_membresia(**kwargs)


def _subir_voucher(**overrides):
    kwargs = dict(
        contenido=b"contenido-voucher", nombre_publico="voucher-1",
        content_type="image/jpeg", pago_id=42,
    )
    kwargs.update(overrides)
    return cc.subir_voucher_pago(**kwargs)


def _subir_foto(**overrides):
    kwargs = dict(
        contenido=b"contenido-foto", nombre_publico="foto-1",
        content_type="image/png", persona_id=7,
    )
    kwargs.update(overrides)
    return cc.subir_foto_perfil(**kwargs)


FUNCIONES = [
    ("subir_pdf_membresia", _subir_pdf),
    ("subir_voucher_pago", _subir_voucher),
    ("subir_foto_perfil", _subir_foto),
]


def _parchear_upload():
    return patch("app.infraestructura.cloudinary_cliente.cloudinary.uploader.upload")


# --- 1. Contrato: cada una de las 3 funciones pasa un Timeout explícito -----
@pytest.mark.parametrize("nombre, invocar", FUNCIONES)
def test_cada_funcion_pasa_un_timeout_urllib3_explicito(nombre, invocar):
    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {"secure_url": "https://cdn.test/recurso"}

        url = invocar()

        assert url == "https://cdn.test/recurso"
        _, kwargs = mock_upload.call_args
        timeout = kwargs["timeout"]
        assert isinstance(timeout, Timeout)
        assert timeout.connect_timeout == 3.0
        assert timeout.total == 8.0


# --- 2. Ruta de error: fallo del vendor -> ServicioNoDisponible -------------
@pytest.mark.parametrize("nombre, invocar", FUNCIONES)
def test_fallo_del_vendor_se_traduce_a_servicio_no_disponible(nombre, invocar):
    with _parchear_upload() as mock_upload:
        mock_upload.side_effect = Exception("Cloudinary caído")

        with pytest.raises(ServicioNoDisponible):
            invocar()


@pytest.mark.parametrize("nombre, invocar", FUNCIONES)
def test_secure_url_ausente_se_traduce_a_servicio_no_disponible(nombre, invocar):
    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {}

        with pytest.raises(ServicioNoDisponible):
            invocar()


# --- 3. Errores de ENTRADA siguen siendo ValueError (no son fallo de vendor,
# ambos servicios validan antes de llamar al SDK) ---------------------------
def test_contenido_vacio_sigue_siendo_value_error():
    with pytest.raises(ValueError):
        cc.subir_pdf_membresia(b"", "pdf-vacio")


def test_mime_no_soportado_sigue_siendo_value_error():
    with pytest.raises(ValueError):
        cc.subir_voucher_pago(b"x", "voucher-x", "application/zip", 1)


# --- 3b. Idempotencia de `overwrite=False`: lock-in (degradacion-controlada,
# slice 1, fase 1.6) -- `subir_pdf_membresia` ya trata un `existing: True`
# del SDK como éxito porque solo lee `secure_url`, presente en ambos casos.
# Esta prueba fija ese comportamiento para que un refactor futuro no lo
# rompa en silencio.
def test_pdf_existente_devuelve_misma_url_sin_error():
    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {
            "secure_url": "https://cdn.test/comprobante-existente.pdf",
            "existing": True,
        }

        url = _subir_pdf()

        assert url == "https://cdn.test/comprobante-existente.pdf"
        assert mock_upload.call_count == 1


# --- 4. Guardia: ninguna función reintenta tras un fallo --------------------
# Invariante crítico del diseño: Celery ya reintenta `subir_pdf_membresia`
# (autoretry_for + backoff + jitter, comprobante_tareas.py:42-45). Un
# reintento acá multiplicaría los intentos contra el proveedor.
@pytest.mark.parametrize("nombre, invocar", FUNCIONES)
def test_ninguna_funcion_reintenta_tras_un_fallo(nombre, invocar):
    with _parchear_upload() as mock_upload:
        mock_upload.side_effect = Exception("Cloudinary caído")

        with pytest.raises(ServicioNoDisponible):
            invocar()

        assert mock_upload.call_count == 1


# --- 5. Guardia: el timeout viene de resiliencia.py, no de un literal futuro
def test_timeout_viene_de_resiliencia_no_de_un_literal(monkeypatch):
    monkeypatch.setattr(cc, "TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS", 99.0)

    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {"secure_url": "https://cdn.test/recurso"}

        _subir_pdf()

        _, kwargs = mock_upload.call_args
        assert kwargs["timeout"].total == 99.0


# --- 6/7. Instrumentación: subida lenta advierte, subida rápida solo informa
# Nota: `esquema_migrado` (conftest, autouse/session) corre Alembic, que
# aplica `fileConfig(alembic.ini)` con `disable_existing_loggers=True` -- eso
# deshabilita cualquier logger `cataclub.*` ya instanciado al momento de
# recolectar los tests. Se reactiva explícitamente acá (no es parte del
# comportamiento bajo prueba, es un efecto de sesión de la suite).
def test_subida_lenta_emite_warning_en_vez_de_info(caplog, monkeypatch):
    monkeypatch.setattr(cc.logger, "disabled", False)
    tiempos = iter([0.0, 4.5])

    with _parchear_upload() as mock_upload, patch(
        "app.infraestructura.cloudinary_cliente.time.perf_counter",
        side_effect=lambda: next(tiempos),
    ):
        mock_upload.return_value = {"secure_url": "https://cdn.test/recurso"}

        with caplog.at_level(logging.INFO, logger="cataclub.cloudinary"):
            _subir_pdf()

    niveles = [r.levelname for r in caplog.records]
    assert "WARNING" in niveles
    assert "INFO" not in niveles


def test_subida_rapida_emite_info_no_warning(caplog, monkeypatch):
    monkeypatch.setattr(cc.logger, "disabled", False)
    tiempos = iter([0.0, 1.0])

    with _parchear_upload() as mock_upload, patch(
        "app.infraestructura.cloudinary_cliente.time.perf_counter",
        side_effect=lambda: next(tiempos),
    ):
        mock_upload.return_value = {"secure_url": "https://cdn.test/recurso"}

        with caplog.at_level(logging.INFO, logger="cataclub.cloudinary"):
            _subir_pdf()

    niveles = [r.levelname for r in caplog.records]
    assert "INFO" in niveles
    assert "WARNING" not in niveles


# --- 8. Circuit breaker (degradacion-controlada, slice 2) -------------------
# El circuito de Cloudinary vive como una única instancia a nivel de módulo
# (`cc._circuito_cloudinary`), compartida por las 3 funciones públicas porque
# todas pasan por `_subir()`. El fixture autouse de `tests/conftest.py` lo
# reinicia entre tests para que el estado de uno no se filtre al siguiente.
def test_circuito_abierto_no_llama_al_sdk():
    for _ in range(CIRCUITO_CLOUDINARY_UMBRAL_FALLOS):
        cc._circuito_cloudinary.registrar_fallo()
    assert cc._circuito_cloudinary.estado == "abierto"

    with _parchear_upload() as mock_upload:
        with pytest.raises(ServicioNoDisponible):
            _subir_pdf()

        assert mock_upload.call_count == 0


# --- 9. Guardia estructural: el umbral/cooldown deben venir de resiliencia.py,
# nunca de un literal -- mismo patrón que
# `test_notificaciones.py::test_timeout_smtp_referencia_la_constante_no_un_literal`.
def test_umbral_cloudinary_referencia_la_constante_no_un_literal():
    codigo_fuente = inspect.getsource(cc)

    patron_umbral = re.compile(r"umbral_fallos\s*=\s*([A-Za-z_]\w*|[0-9]+(?:\.[0-9]+)?)")
    patron_cooldown = re.compile(r"cooldown_segundos\s*=\s*([A-Za-z_]\w*|[0-9]+(?:\.[0-9]+)?)")

    coincidencia_umbral = patron_umbral.search(codigo_fuente)
    coincidencia_cooldown = patron_cooldown.search(codigo_fuente)

    assert coincidencia_umbral, "no se encontró 'umbral_fallos=' en la construcción del CircuitoBreaker"
    assert coincidencia_cooldown, "no se encontró 'cooldown_segundos=' en la construcción del CircuitoBreaker"

    valor_umbral = coincidencia_umbral.group(1)
    valor_cooldown = coincidencia_cooldown.group(1)
    assert valor_umbral == "CIRCUITO_CLOUDINARY_UMBRAL_FALLOS", (
        "umbral_fallos debe referenciar la constante importada de resiliencia.py, "
        f"no un literal numérico; se encontró: {valor_umbral!r}"
    )
    assert valor_cooldown == "CIRCUITO_CLOUDINARY_COOLDOWN_SEGUNDOS", (
        "cooldown_segundos debe referenciar la constante importada de resiliencia.py, "
        f"no un literal numérico; se encontró: {valor_cooldown!r}"
    )
