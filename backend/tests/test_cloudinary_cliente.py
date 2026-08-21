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
from unittest.mock import patch

import pytest
from urllib3.util import Timeout

import app.infraestructura.cloudinary_cliente as cc
from app.dominio.excepciones import ServicioNoDisponible
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import (
    CIRCUITO_CLOUDINARY_UMBRAL_FALLOS,
    CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS,
)


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


# --- 10. Hallazgo de privacidad "voucher no enumerable" ---------------------
# El comprobante bancario y el PDF oficial se subían con un `public_id`
# secuencial y SIN `type="authenticated"`: cualquiera que conociera (o
# adivinara) el `public_id` lo descargaba directo de Cloudinary, sin pasar
# por ningún chequeo del backend. Estos tests fijan el arreglo: el upload
# pide un recurso privado, y la URL de entrega se firma (y, si la cuenta lo
# soporta, vence) recién en cada lectura autorizada.

@pytest.mark.parametrize(
    "nombre, invocar",
    [("subir_pdf_membresia", _subir_pdf), ("subir_voucher_pago", _subir_voucher)],
)
def test_voucher_y_comprobante_se_suben_como_type_authenticated(nombre, invocar):
    with _parchear_upload() as mock_upload:
        mock_upload.return_value = {"secure_url": "https://cdn.test/recurso"}

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


def test_url_firmada_de_pdf_fuerza_formato_y_resource_type_raw():
    url = cc.generar_url_firmada(
        "comprobante-00000005",
        resource_type="raw",
        folder=settings.cloudinary_carpeta_comprobantes,
        formato="pdf",
    )
    assert "/raw/authenticated/" in url
    assert url.endswith(".pdf") or ".pdf?" in url


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
    url = cc.generar_url_firmada(
        "comprobante-00000004",
        resource_type="raw",
        folder=settings.cloudinary_carpeta_comprobantes,
        formato="pdf",
    )

    assert f"{settings.cloudinary_carpeta_comprobantes}/comprobante-00000004" in url


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
