"""
Tests de `cloudinary_cliente.py`: `_subir()` es el ÚNICO punto donde el
módulo llama a `cloudinary.uploader.upload`. Estos tests cubren su contrato
de timeout, su traducción de fallos del vendor y la ausencia total de
reintento dentro del módulo.

Ningún test toca la red: se parchea `cloudinary.uploader.upload` (mismo
criterio que `test_notificaciones.py:16` para `smtplib.SMTP`) — probar que un
socket realmente expira sería probar una dependencia, no nuestro código.
`generar_url_firmada`/`resolver_url_entrega` tampoco tocan la red (firman
localmente), así que sus tests corren directo, sin mock de `cloudinary.
uploader` -- solo con las credenciales de prueba que fija el autouse
`_cloudinary_credenciales_de_prueba` de `conftest.py`.
"""
import inspect
import logging
import re
import time
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest
from urllib3.util import Timeout

import app.infraestructura.cloudinary_cliente as cc
from app.dominio.excepciones import ServicioNoDisponible
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import (
    CIRCUITO_CLOUDINARY_UMBRAL_FALLOS,
    CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS,
)


def _parametros(url: str) -> dict[str, str]:
    """Query string de una URL de entrega, decodificado. El endpoint de
    descarga de la API lleva el `public_id` como parámetro url-encodeado
    (`cataclub%2Fcomprobantes%2F...`), así que buscarlo como substring de la
    URL cruda no encuentra nada aunque esté."""
    return {clave: valores[0] for clave, valores in parse_qs(urlparse(url).query).items()}


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


def _subir_logo(**overrides):
    kwargs = dict(
        contenido=b"contenido-logo", nombre_publico="logo-1", content_type="image/png",
    )
    kwargs.update(overrides)
    return cc.subir_logo_sponsor(**kwargs)


FUNCIONES = [
    ("subir_pdf_membresia", _subir_pdf),
    ("subir_voucher_pago", _subir_voucher),
    ("subir_foto_perfil", _subir_foto),
    # El logo de patrocinador es la 4ta función pública que pasa por
    # `_subir()`; estaba fuera de esta lista y por lo tanto de todos los
    # candados de contrato de abajo (issue #838).
    ("subir_logo_sponsor", _subir_logo),
]


def _parchear_upload():
    return patch("app.infraestructura.cloudinary_cliente.cloudinary.uploader.upload")


def _parchear_destroy():
    return patch("app.infraestructura.cloudinary_cliente.cloudinary.uploader.destroy")


# --- 1. Contrato: cada una de las 3 funciones pasa un Timeout explícito -----
@pytest.mark.parametrize("nombre, invocar", FUNCIONES)
def test_cada_funcion_pasa_un_timeout_urllib3_explicito(nombre, invocar):
    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {"secure_url": "https://cdn.test/recurso", "version": 123}

        resultado = invocar()

        # `subir_foto_perfil` devuelve `version` (issue #662), no la URL del
        # SDK -- las otras 2 siguen devolviendo `secure_url` tal cual.
        if nombre == "subir_foto_perfil":
            assert resultado == 123
        else:
            assert resultado == "https://cdn.test/recurso"
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


# --- 4b. Guardia: el mensaje que ve el usuario no filtra el error crudo del
# vendor (issue #347). Sin credencial, el SDK levanta un `ValueError` cuyo
# texto ("Must supply api_key") es interno de Cloudinary -- `_MAPA_EXCEPCIONES`
# de main.py devuelve `exc.mensaje` tal cual en el body de la respuesta 503,
# así que ese texto crudo llegaba directo al socio. El texto del vendor debe
# quedar en `detalle_tecnico` (log), nunca en `mensaje` (API/usuario).
@pytest.mark.parametrize("nombre, invocar", FUNCIONES)
def test_fallo_por_credencial_ausente_no_filtra_el_error_crudo_del_vendor(nombre, invocar):
    with _parchear_upload() as mock_upload:
        mock_upload.side_effect = ValueError("Must supply api_key")

        with pytest.raises(ServicioNoDisponible) as exc_info:
            invocar()

    exc = exc_info.value
    assert "api_key" not in exc.mensaje.lower(), (
        f"el mensaje de cara al usuario filtra el error crudo del vendor: {exc.mensaje!r}"
    )
    assert exc.detalle_tecnico, "el detalle técnico (para el log) no puede quedar vacío"
    assert "Must supply api_key" in exc.detalle_tecnico


def test_fallo_cloudinary_redacta_credenciales_de_log_y_detalle(monkeypatch, caplog):
    secreto = "cloudinary-secret-no-registrar"
    monkeypatch.setattr(settings, "cloudinary_api_secret", secreto)
    monkeypatch.setattr(cc.logger, "disabled", False)

    with _parchear_upload() as mock_upload:
        mock_upload.side_effect = RuntimeError(f"vendor rechazó secret={secreto}")
        with caplog.at_level(logging.ERROR, logger="cataclub.cloudinary"):
            with pytest.raises(ServicioNoDisponible) as error:
                _subir_pdf()

    assert secreto not in caplog.text
    assert secreto not in error.value.detalle_tecnico
    assert "[REDACTED]" in caplog.text


def test_subida_exitosa_no_registra_la_url_firmada(monkeypatch, caplog):
    url_firmada = "https://cdn.test/recurso?__cld_token__=sensible"
    monkeypatch.setattr(cc.logger, "disabled", False)

    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {"secure_url": url_firmada}
        with caplog.at_level(logging.INFO, logger="cataclub.cloudinary"):
            _subir_pdf()

    assert url_firmada not in caplog.text
    assert "__cld_token__" not in caplog.text


# --- 4c. Guardia (issue #355): los 3 `raise ServicioNoDisponible(...)` de
# `_subir()` -- circuito abierto, fallo del SDK, `secure_url` ausente --
# marcan `seguro_mostrar=True`. Es el único mensaje de todo el backend
# marcado así: `main.py::_MAPA_EXCEPCIONES` lo usa para decidir si el 503
# puede llevar `mensaje` tal cual en el body (`mensaje_seguro`), en vez del
# genérico que descarta cualquier otro 5xx por defecto.
def test_los_3_sitios_de_servicio_no_disponible_marcan_seguro_mostrar():
    with _parchear_upload() as mock_upload:
        mock_upload.side_effect = Exception("Cloudinary caído")
        with pytest.raises(ServicioNoDisponible) as exc_fallo_vendor:
            _subir_pdf()
    assert exc_fallo_vendor.value.seguro_mostrar is True

    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {}
        with pytest.raises(ServicioNoDisponible) as exc_sin_url:
            _subir_pdf()
    assert exc_sin_url.value.seguro_mostrar is True

    for _ in range(CIRCUITO_CLOUDINARY_UMBRAL_FALLOS):
        cc._circuito_cloudinary.registrar_fallo()
    with _parchear_upload() as mock_upload:
        with pytest.raises(ServicioNoDisponible) as exc_circuito_abierto:
            _subir_pdf()
    assert exc_circuito_abierto.value.seguro_mostrar is True


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
# (`cc._circuito_cloudinary`), compartida por TODAS las llamadas de red del
# módulo: las 4 subidas, que pasan por `_subir()`, y `eliminar_logo_sponsor`,
# que llama al SDK por su cuenta (issue #838). El fixture autouse de
# `tests/conftest.py` lo reinicia entre tests para que el estado de uno no se
# filtre al siguiente.
def test_circuito_abierto_no_llama_al_sdk():
    for _ in range(CIRCUITO_CLOUDINARY_UMBRAL_FALLOS):
        cc._circuito_cloudinary.registrar_fallo()
    assert cc._circuito_cloudinary.estado == "abierto"

    with _parchear_upload() as mock_upload:
        with pytest.raises(ServicioNoDisponible):
            _subir_pdf()

        assert mock_upload.call_count == 0


# --- 8b. `eliminar_logo_sponsor`: la ÚNICA llamada de red del módulo que no
# pasa por `_subir()` (issue #838, punto 3). Antes del fix no pasaba
# `timeout=` ni consultaba `_circuito_cloudinary`: un Cloudinary caído nunca
# abría el circuito para borrados, y cada request lo seguía intentando contra
# un par TCP que puede no responder nunca -- sobre el event loop, o sea
# colgando el proceso entero. `destroy()` acepta el mismo kwarg `timeout` que
# `upload()`.

def test_eliminar_logo_sponsor_pasa_un_timeout_urllib3_explicito():
    with _parchear_destroy() as mock_destroy:
        mock_destroy.return_value = {"result": "ok"}

        cc.eliminar_logo_sponsor("logo-1")

        _, kwargs = mock_destroy.call_args
        timeout = kwargs["timeout"]
        assert isinstance(timeout, Timeout), (
            "un float se convierte en timeout per-operación de socket, sin "
            "cota de reloj de pared: solo un `urllib3.util.Timeout` respeta `total=`"
        )
        assert timeout.connect_timeout == 3.0
        assert timeout.total == 8.0


def test_eliminar_logo_sponsor_toma_el_timeout_de_resiliencia_no_de_un_literal(monkeypatch):
    monkeypatch.setattr(cc, "TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS", 99.0)

    with _parchear_destroy() as mock_destroy:
        mock_destroy.return_value = {"result": "ok"}

        cc.eliminar_logo_sponsor("logo-1")

        _, kwargs = mock_destroy.call_args
        assert kwargs["timeout"].total == 99.0


def test_eliminar_logo_sponsor_con_circuito_abierto_no_llama_al_sdk():
    """Mismo contrato que `_subir`: con el circuito ABIERTO se levanta
    `ServicioNoDisponible` SIN gastar la llamada al proveedor."""
    for _ in range(CIRCUITO_CLOUDINARY_UMBRAL_FALLOS):
        cc._circuito_cloudinary.registrar_fallo()
    assert cc._circuito_cloudinary.estado == "abierto"

    with _parchear_destroy() as mock_destroy:
        with pytest.raises(ServicioNoDisponible) as error:
            cc.eliminar_logo_sponsor("logo-1")

        assert mock_destroy.call_count == 0
    assert error.value.seguro_mostrar is True


def test_eliminar_logo_sponsor_registra_el_fallo_en_el_circuito():
    """Sin esto, un Cloudinary caído nunca abría el circuito por el camino de
    borrado: los fallos no se contaban en ningún lado."""
    with _parchear_destroy() as mock_destroy:
        mock_destroy.side_effect = Exception("Cloudinary caído")

        with pytest.raises(ServicioNoDisponible) as error:
            cc.eliminar_logo_sponsor("logo-1")

    assert cc._circuito_cloudinary.fallos_consecutivos == 1
    # Mismo criterio que las 3 ramas de `_subir` y que la rama de circuito
    # abierto de acá arriba: `main.py::_MAPA_EXCEPCIONES` solo copia `mensaje`
    # al body del 503 si está marcado como seguro; sin esto, el admin recibe
    # el genérico que descarta cualquier 5xx.
    assert error.value.seguro_mostrar is True


def test_eliminar_logo_sponsor_abre_el_circuito_tras_el_umbral_de_fallos():
    with _parchear_destroy() as mock_destroy:
        mock_destroy.side_effect = Exception("Cloudinary caído")

        for _ in range(CIRCUITO_CLOUDINARY_UMBRAL_FALLOS):
            with pytest.raises(ServicioNoDisponible):
                cc.eliminar_logo_sponsor("logo-1")

        assert cc._circuito_cloudinary.estado == "abierto"

        llamadas_hasta_abrir = mock_destroy.call_count
        with pytest.raises(ServicioNoDisponible):
            cc.eliminar_logo_sponsor("logo-1")

        assert mock_destroy.call_count == llamadas_hasta_abrir


def test_eliminar_logo_sponsor_exitoso_registra_el_exito_en_el_circuito():
    cc._circuito_cloudinary.registrar_fallo()
    assert cc._circuito_cloudinary.fallos_consecutivos == 1

    with _parchear_destroy() as mock_destroy:
        mock_destroy.return_value = {"result": "ok"}

        cc.eliminar_logo_sponsor("logo-1")

    assert cc._circuito_cloudinary.fallos_consecutivos == 0


def test_eliminar_logo_sponsor_no_reintenta_tras_un_fallo():
    """Mismo invariante que `_subir`: un reintento acá multiplicaría los
    intentos contra el proveedor sin resolver nada."""
    with _parchear_destroy() as mock_destroy:
        mock_destroy.side_effect = Exception("Cloudinary caído")

        with pytest.raises(ServicioNoDisponible):
            cc.eliminar_logo_sponsor("logo-1")

        assert mock_destroy.call_count == 1


def test_fallo_al_eliminar_logo_redacta_credenciales_de_log_y_detalle(monkeypatch, caplog):
    """Equivalente para el borrado del candado de redacción de `_subir`
    (`test_fallo_cloudinary_redacta_credenciales_de_log_y_detalle`).

    Redactar solo `detalle_tecnico` no alcanza: un `logger.exception` escribe
    el traceback COMPLETO, y su última línea es `Tipo: str(exc)` sin pasar por
    `_redactar_detalle_sensible` -- la credencial termina igual en el log."""
    secreto = "cloudinary-secret-no-registrar"
    monkeypatch.setattr(settings, "cloudinary_api_secret", secreto)
    monkeypatch.setattr(cc.logger, "disabled", False)

    with _parchear_destroy() as mock_destroy:
        mock_destroy.side_effect = RuntimeError(f"vendor rechazó secret={secreto}")
        with caplog.at_level(logging.ERROR, logger="cataclub.cloudinary"):
            with pytest.raises(ServicioNoDisponible) as error:
                cc.eliminar_logo_sponsor("logo-1")

    assert secreto not in caplog.text
    assert secreto not in error.value.detalle_tecnico
    assert "[REDACTED]" in caplog.text


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


# --- 10. Hallazgo de privacidad "voucher no enumerable" ---------------------
# El comprobante bancario y el PDF oficial se subían con un `public_id`
# secuencial y SIN `type="authenticated"`: cualquiera que conociera (o
# adivinara) el `public_id` lo descargaba directo de Cloudinary, sin pasar
# por ningún chequeo del backend. Estos tests fijan el arreglo: el upload
# pide un recurso privado, y la URL de entrega se firma (y, si la cuenta lo
# soporta, vence) recién en cada lectura autorizada.

@pytest.mark.parametrize(
    "nombre, invocar",
    [
        ("subir_pdf_membresia", _subir_pdf),
        ("subir_voucher_pago", _subir_voucher),
        # Issue #553 (Problema 2): la foto de perfil se subía SIN
        # `type="authenticated"` y con `public_id` predecible
        # (`perfil_{persona_id}`) -- misma clase de hallazgo que el voucher,
        # mismo candado.
        ("subir_foto_perfil", _subir_foto),
    ],
)
def test_voucher_y_comprobante_se_suben_como_type_authenticated(nombre, invocar):
    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {"secure_url": "https://cdn.test/recurso", "version": 123}

        invocar()

        _, kwargs = mock_upload.call_args
        assert kwargs["type"] == "authenticated", (
            f"{nombre} debe subir el recurso como type=\"authenticated\" -- "
            "sin esto, la URL pública de Cloudinary queda accesible sin "
            "autenticación para quien la adivine (voucher-pago-00000012, "
            "comprobante-00000013, ...)."
        )


def test_url_firmada_no_es_igual_a_una_url_publica_de_upload():
    """Candado central del hallazgo: la URL de entrega para un
    `type="authenticated"` NUNCA es la URL de `type="upload"` (pública, sin
    firmar) que tendría el mismo public_id. Si en algún momento alguien
    revierte `generar_url_firmada` a construir la URL a mano en vez de pedirle
    la firma al SDK, este test se rompe."""
    url = cc.generar_url_firmada(
        "voucher-pago-00000012",
        resource_type="image",
        folder=settings.cloudinary_carpeta_vouchers,
    )

    url_publica_sin_firmar = (
        f"https://res.cloudinary.com/{settings.cloudinary_cloud_name}"
        "/image/upload/voucher-pago-00000012"
    )
    assert url != url_publica_sin_firmar
    assert "/authenticated/" in url
    assert "/upload/" not in url


def test_url_firmada_de_pdf_pide_el_recurso_raw_authenticated_con_su_extension():
    """Un PDF se entrega por el endpoint de descarga de la API, no por la CDN
    (ver `_url_descarga_api`), pero sigue pidiendo el MISMO recurso: `raw`,
    `type=authenticated`, y el `public_id` con la extensión `.pdf` con la que
    Cloudinary lo indexó al subirlo con `format="pdf"`."""
    url = cc.generar_url_firmada(
        "comprobante-00000005",
        resource_type="raw",
        folder=settings.cloudinary_carpeta_comprobantes,
        formato="pdf",
    )

    parametros = _parametros(url)
    assert url.startswith(
        f"https://api.cloudinary.com/v1_1/{settings.cloudinary_cloud_name}/raw/download"
    )
    assert parametros["type"] == "authenticated"
    assert parametros["public_id"].endswith(".pdf")


def test_url_firmada_sin_clave_de_token_queda_firmada_pero_sin_vencer(monkeypatch):
    monkeypatch.setattr(settings, "cloudinary_auth_token_key", "")

    url = cc.generar_url_firmada(
        "voucher-pago-00000001",
        resource_type="image",
        folder=settings.cloudinary_carpeta_vouchers,
    )

    assert "__cld_token__" not in url


def test_url_firmada_con_clave_de_token_agrega_vencimiento_real(monkeypatch):
    monkeypatch.setattr(settings, "cloudinary_auth_token_key", "clave-de-token-de-cuenta")

    with patch("app.infraestructura.cloudinary_cliente.cloudinary.utils.cloudinary_url") as mock_url:
        mock_url.return_value = ("https://cdn.test/firmada", {})

        cc.generar_url_firmada(
            "voucher-pago-00000001",
            resource_type="image",
            folder=settings.cloudinary_carpeta_vouchers,
        )

        _, kwargs = mock_url.call_args
        assert kwargs["auth_token"] == {
            "key": "clave-de-token-de-cuenta",
            "duration": CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS,
        }


def test_url_firmada_no_hace_red_ni_consulta_el_circuito():
    """`generar_url_firmada` firma localmente (HMAC con el api_secret ya
    cargado) -- no debe llamar a `cloudinary.uploader.upload` ni depender del
    circuit breaker. Se fuerza el circuito ABIERTO para probar que igual
    genera la URL."""
    for _ in range(CIRCUITO_CLOUDINARY_UMBRAL_FALLOS):
        cc._circuito_cloudinary.registrar_fallo()
    assert cc._circuito_cloudinary.estado == "abierto"

    with _parchear_upload() as mock_upload:
        url = cc.generar_url_firmada(
            "voucher-pago-00000001",
            resource_type="image",
            folder=settings.cloudinary_carpeta_vouchers,
        )

        assert url
        assert mock_upload.call_count == 0


# --- 11. `resolver_url_entrega`: filas previas al fix no se rompen ----------

def test_resolver_url_entrega_sin_valor_devuelve_none():
    assert cc.resolver_url_entrega(
        None, resource_type="image", folder=settings.cloudinary_carpeta_vouchers,
    ) is None
    assert cc.resolver_url_entrega(
        "", resource_type="image", folder=settings.cloudinary_carpeta_vouchers,
    ) is None


def test_resolver_url_entrega_de_una_fila_previa_al_fix_no_se_toca():
    """Filas creadas ANTES de este fix guardaron la `secure_url` completa de
    un recurso `type="upload"` (pública). No hay forma de repararlas sin
    volver a subir el archivo con las credenciales reales de Cloudinary
    (ausentes en este entorno) -- se devuelven sin cambios en vez de
    romperlas en silencio; ver docs/archive/fixes/16-voucher-no-enumerable.md."""
    url_heredada = "https://res.cloudinary.com/cataclub/image/upload/voucher-pago-00000003.jpg"

    resultado = cc.resolver_url_entrega(
        url_heredada, resource_type="image", folder=settings.cloudinary_carpeta_vouchers,
    )

    assert resultado == url_heredada


def test_resolver_url_entrega_de_un_public_id_lo_firma():
    resultado = cc.resolver_url_entrega(
        "voucher-pago-00000004",
        resource_type="image",
        folder=settings.cloudinary_carpeta_vouchers,
    )

    assert resultado != "voucher-pago-00000004"
    assert "/authenticated/" in resultado
    assert "voucher-pago-00000004" in resultado


def test_resolver_url_entrega_de_una_fila_previa_al_fix_con_esquema_en_mayusculas_no_se_toca():
    """El esquema puede llegar en mayúsculas (`HTTPS://...`). El detector
    debe reconocerlo igual que la variante en minúsculas -- Cloudinary
    siempre emite el esquema en minúsculas, pero el detector no debe
    asumirlo, porque tratar esto como `public_id` mandaría el valor a firmar
    y produciría una URL basura."""
    url_heredada_mayusculas = "HTTPS://res.cloudinary.com/cataclub/image/upload/voucher-pago-00000005.jpg"

    resultado = cc.resolver_url_entrega(
        url_heredada_mayusculas,
        resource_type="image",
        folder=settings.cloudinary_carpeta_vouchers,
    )

    assert resultado == url_heredada_mayusculas


def test_resolver_url_entrega_de_un_public_id_con_dos_puntos_no_se_confunde_con_una_url():
    """Un `public_id` puede llevar `:` como separador lógico de carpeta
    (p. ej. `foo:bar/baz`). No tiene esquema `http`/`https`, así que debe
    firmarse como cualquier otro `public_id`, no tratarse como URL heredada."""
    public_id_con_dos_puntos = "foo:bar/baz"

    resultado = cc.resolver_url_entrega(
        public_id_con_dos_puntos, resource_type="image", folder="cataclub/vouchers",
    )

    assert resultado != public_id_con_dos_puntos
    assert "/authenticated/" in resultado


# --- 12. La URL de entrega incluye la carpeta de subida (issue #480) --------
# Cloudinary indexa un recurso subido con `folder=` + `public_id=` bajo
# `{folder}/{public_id}`, NO bajo `public_id` solo -- eso es un detalle del
# vendor que ningún mock revela (por eso el bug real llegó a producción sin
# que ningún test lo agarrara, ver docs/archive/fixes/16-voucher-no-enumerable.md).
# `Pago.voucher_url`/`ComprobantePago.archivo_url` persisten el `public_id`
# SIN la carpeta (`membresia_pago_servicio.py`); si `generar_url_firmada` no
# la vuelve a anteponer, firma una URL para un recurso que Cloudinary nunca
# tuvo bajo ese nombre exacto -- firma válida, 404 igual.

def test_url_firmada_antepone_la_carpeta_de_subida():
    url = cc.generar_url_firmada(
        "voucher-pago-00000004",
        resource_type="image",
        folder=settings.cloudinary_carpeta_vouchers,
    )

    assert f"{settings.cloudinary_carpeta_vouchers}/voucher-pago-00000004" in url


def test_url_firmada_de_comprobante_antepone_su_propia_carpeta():
    """Mismo candado del issue #480 para el PDF: la carpeta viaja igual, solo
    que ahora dentro del parámetro `public_id` del endpoint de descarga (por
    eso se lee decodificado y no como substring de la URL cruda)."""
    url = cc.generar_url_firmada(
        "comprobante-00000004",
        resource_type="raw",
        folder=settings.cloudinary_carpeta_comprobantes,
        formato="pdf",
    )

    assert _parametros(url)["public_id"] == (
        f"{settings.cloudinary_carpeta_comprobantes}/comprobante-00000004.pdf"
    )


def test_resolver_url_entrega_de_un_public_id_antepone_la_carpeta():
    resultado = cc.resolver_url_entrega(
        "voucher-pago-00000004",
        resource_type="image",
        folder=settings.cloudinary_carpeta_vouchers,
    )

    assert f"{settings.cloudinary_carpeta_vouchers}/voucher-pago-00000004" in resultado


def test_resolver_url_entrega_de_una_fila_previa_al_fix_no_antepone_carpeta():
    """Las filas heredadas (URL pública completa, detectadas por esquema)
    siguen devolviéndose tal cual -- `folder` no debe tocarlas."""
    url_heredada = "https://res.cloudinary.com/cataclub/image/upload/voucher-pago-00000003.jpg"

    resultado = cc.resolver_url_entrega(
        url_heredada, resource_type="image", folder=settings.cloudinary_carpeta_vouchers,
    )

    assert resultado == url_heredada


# --- 12b. Entrega de PDF: NUNCA por la CDN ---------------------------------
# La cuenta deniega la entrega de todo PDF por `res.cloudinary.com`: la URL
# firmada respondía `401` con `x-cld-error: deny or ACL failure` y
# `content-length: 0`, y el backend nunca se enteraba porque firmar no toca la
# red. Estos tests son candados de FORMA, no de entrega -- lo que realmente
# descarga el PDF de la cuenta real es
# `backend/scripts/verificar_entrega_pdf.py` (`make qa-pdf-delivery-check`),
# el único chequeo que sí hace el GET. Misma clase de punto ciego que el
# issue #480, ahora con un chequeo que lo cubre.

def test_url_firmada_de_pdf_no_sale_por_la_cdn():
    """Candado central del fix: la URL de entrega de un PDF NO puede apuntar a
    `res.cloudinary.com`. Si alguien devuelve el PDF a `cloudinary_url`, el
    socio vuelve a recibir un 401 en blanco y este test se rompe antes."""
    url = cc.generar_url_firmada(
        "comprobante-00000005",
        resource_type="raw",
        folder=settings.cloudinary_carpeta_comprobantes,
        formato="pdf",
    )

    assert "res.cloudinary.com" not in url
    assert url.startswith("https://api.cloudinary.com/v1_1/")
    assert "/raw/download?" in url


def test_url_firmada_de_imagen_sigue_saliendo_por_la_cdn():
    """La contracara: la imagen (voucher JPEG/PNG y foto de perfil) SÍ se
    entrega por CDN -- se comprobó que responde 200 con la misma firma. El fix
    del PDF no debe arrastrarla al endpoint de descarga, que no transforma ni
    cachea por `version` (issue #662)."""
    url = cc.generar_url_firmada(
        "voucher-pago-00000012",
        resource_type="image",
        folder=settings.cloudinary_carpeta_vouchers,
    )

    assert url.startswith("https://res.cloudinary.com/")
    assert "/image/authenticated/" in url


def test_url_firmada_de_pdf_vence_con_la_vigencia_de_resiliencia():
    """A diferencia de la CDN (que sin `cloudinary_auth_token_key` firmaba un
    link sin vencimiento), el endpoint de descarga CHEQUEA `expires_at` del
    lado del servidor. El vencimiento sale de la constante de política, no de
    un literal."""
    antes = int(time.time())

    parametros = _parametros(cc.generar_url_firmada(
        "comprobante-00000005",
        resource_type="raw",
        folder=settings.cloudinary_carpeta_comprobantes,
        formato="pdf",
    ))

    despues = int(time.time())
    vencimiento = int(parametros["expires_at"])
    assert antes + CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS <= vencimiento
    assert vencimiento <= despues + CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS


def test_url_firmada_de_pdf_no_expone_el_api_secret():
    """El endpoint de descarga lleva la `api_key` en el query string (así lo
    diseñó Cloudinary: es un identificador público). El `api_secret`, que es
    lo que permite firmar, NO puede aparecer nunca."""
    url = cc.generar_url_firmada(
        "comprobante-00000005",
        resource_type="raw",
        folder=settings.cloudinary_carpeta_comprobantes,
        formato="pdf",
    )

    assert settings.cloudinary_api_secret
    assert settings.cloudinary_api_secret not in url
    assert _parametros(url)["signature"]


def test_url_firmada_de_pdf_cambia_en_cada_lectura(monkeypatch):
    """Un voucher en PDF se sube con `overwrite=True` bajo el mismo
    `public_id`: si la URL fuera byte-idéntica entre lecturas, el navegador
    seguiría mostrando el PDF viejo tras una corrección (misma clase de fallo
    que el issue #662 en la foto de perfil). El reloj se inyecta reemplazando
    `cc.time` -- parchear `time.time` global lo cambiaría también para el SDK,
    que lo usa para su propio `timestamp`."""
    class _Reloj:
        def __init__(self, valor):
            self.valor = valor

        def time(self):
            return self.valor

    def url_de_pdf():
        return cc.generar_url_firmada(
            "voucher-pago-00000012",
            resource_type="raw",
            folder=settings.cloudinary_carpeta_vouchers,
            formato="pdf",
        )

    reloj = _Reloj(1_700_000_000.0)
    monkeypatch.setattr(cc, "time", reloj)
    primera = url_de_pdf()
    reloj.valor += 1.0
    segunda = url_de_pdf()

    assert primera != segunda
    assert int(_parametros(segunda)["expires_at"]) - int(_parametros(primera)["expires_at"]) == 1


def test_url_firmada_de_pdf_no_hace_red_ni_consulta_el_circuito():
    """Mismo contrato que la rama de imagen: firmar el link de descarga es
    HMAC local, no una llamada al proveedor. Debe seguir funcionando con el
    circuito ABIERTO -- si no, un Cloudinary caído dejaría de entregar PDFs ya
    subidos."""
    for _ in range(CIRCUITO_CLOUDINARY_UMBRAL_FALLOS):
        cc._circuito_cloudinary.registrar_fallo()
    assert cc._circuito_cloudinary.estado == "abierto"

    with _parchear_upload() as mock_upload:
        url = cc.generar_url_firmada(
            "comprobante-00000005",
            resource_type="raw",
            folder=settings.cloudinary_carpeta_comprobantes,
            formato="pdf",
        )

        assert url
        assert mock_upload.call_count == 0


def test_resolver_url_entrega_de_un_pdf_usa_el_endpoint_de_descarga():
    """El camino real que recorren `_url_entrega_comprobante` y
    `_url_entrega_voucher` (membresia_pago_servicio.py) para un PDF."""
    resultado = cc.resolver_url_entrega(
        "comprobante-00000004",
        resource_type="raw",
        folder=settings.cloudinary_carpeta_comprobantes,
        formato="pdf",
    )

    assert resultado is not None
    assert "res.cloudinary.com" not in resultado
    assert _parametros(resultado)["public_id"].endswith("/comprobante-00000004.pdf")


# --- 13. `resolver_url_foto_perfil` (issue #553, Problema 2) ----------------
# La foto de perfil replica el patrón del voucher: `Persona.foto_url` pasa a
# persistir el `public_id` (`perfil_{persona_id}`) y la URL de entrega se
# firma fresca en cada lectura autorizada. Este helper fija resource_type y
# carpeta para que TODOS los puntos de serialización (auth + personas) firmen
# contra el mismo recurso indexado (`{carpeta}/{public_id}`, issue #480).

def test_resolver_url_foto_perfil_de_un_public_id_lo_firma_con_su_carpeta():
    resultado = cc.resolver_url_foto_perfil("perfil_7")

    assert resultado != "perfil_7"
    assert "/authenticated/" in resultado
    assert f"{settings.cloudinary_carpeta_fotos_perfil}/perfil_7" in resultado


def test_resolver_url_foto_perfil_de_una_fila_previa_al_fix_no_se_toca():
    """Fotos subidas antes del fix guardaron la `secure_url` completa de un
    recurso `type="upload"` (público). Se devuelven sin cambios hasta que el
    operador corra `scripts/migrar_fotos_perfil_autenticadas.py`."""
    url_heredada = "https://res.cloudinary.com/cataclub/image/upload/perfil_7.jpg"

    assert cc.resolver_url_foto_perfil(url_heredada) == url_heredada


def test_resolver_url_foto_perfil_sin_valor_devuelve_none():
    assert cc.resolver_url_foto_perfil(None) is None
    assert cc.resolver_url_foto_perfil("") is None


def test_resolver_url_foto_perfil_sin_credenciales_de_firma_devuelve_none(monkeypatch):
    """Sin CLOUDINARY_API_SECRET (Cloudinary es opcional por diseño), firmar
    reventaría el login (`/auth/me` 500 -> BFF 503) con
    `ValueError: Must supply api_secret`. Debe degradar a None, no romper."""
    monkeypatch.setattr(settings, "cloudinary_api_secret", "")

    assert cc.resolver_url_foto_perfil("perfil_7") is None


# --- 14. Issue #662: cache-busting de la foto de perfil por `version` -------
# `public_id` es determinístico (`perfil_{persona_id}`) y el upload usa
# `overwrite=True`: sin distinguir por `version`, dos subidas para la misma
# persona firman la URL de entrega byte-idéntica y el navegador sigue
# sirviendo la imagen cacheada de la carga anterior tras un reemplazo real.

def test_subir_foto_perfil_devuelve_el_version_del_vendor_no_la_url():
    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {"secure_url": "https://cdn.test/recurso", "version": 1690000042}

        resultado = _subir_foto()

        assert resultado == 1690000042


def test_subir_foto_perfil_sin_version_del_vendor_se_traduce_a_servicio_no_disponible():
    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {"secure_url": "https://cdn.test/recurso"}  # sin "version"

        with pytest.raises(ServicioNoDisponible):
            _subir_foto()


def test_componer_valor_foto_perfil_combina_public_id_y_version():
    assert cc.componer_valor_foto_perfil("perfil_7", 1690000042) == "perfil_7|1690000042"


def test_resolver_url_foto_perfil_de_un_valor_compuesto_incluye_el_version_en_la_url():
    valor = cc.componer_valor_foto_perfil("perfil_7", 1690000042)

    resultado = cc.resolver_url_foto_perfil(valor)

    assert resultado is not None
    assert "/v1690000042/" in resultado
    assert f"{settings.cloudinary_carpeta_fotos_perfil}/perfil_7" in resultado


def test_resolver_url_foto_perfil_de_dos_versiones_distintas_da_urls_distintas():
    """El candado central del fix: dos subidas (dos `version` distintos) para
    el mismo `public_id` deben resolver a URLs de entrega DISTINTAS."""
    valor_v1 = cc.componer_valor_foto_perfil("perfil_7", 1690000001)
    valor_v2 = cc.componer_valor_foto_perfil("perfil_7", 1690000002)

    url_v1 = cc.resolver_url_foto_perfil(valor_v1)
    url_v2 = cc.resolver_url_foto_perfil(valor_v2)

    assert url_v1 != url_v2


def test_resolver_url_foto_perfil_de_un_public_id_persistido_antes_del_fix_sigue_resolviendo():
    """Filas persistidas ENTRE issue #553 y issue #662 guardaron solo el
    `public_id`, sin `version` (esta app no lo tenía disponible todavía). No
    deben romperse: el SDK sigue firmando (con su propio default de
    `version=1`, no un `version` real de Cloudinary) hasta la próxima subida
    real, que sí compone el valor nuevo con el `version` real."""
    resultado_v1 = cc.resolver_url_foto_perfil("perfil_7")
    resultado_v2 = cc.resolver_url_foto_perfil("perfil_7")

    assert resultado_v1 is not None
    assert "/v1/" in resultado_v1
    # Sin `version` explícito, el SDK usa el mismo default en cada llamada:
    # dos lecturas de la MISMA fila legacy siguen dando la MISMA URL -- ese
    # es justamente el residual documentado (no cache-busting), no algo que
    # este fix prometa resolver para filas que no persisten `version`.
    assert resultado_v1 == resultado_v2
