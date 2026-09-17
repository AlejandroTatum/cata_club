"""Tests del script one-off `scripts/migrar_imagenes_a_raw.py` (issue #1072).

Las imágenes privadas subidas ANTES del fix son recursos
`image/authenticated` con `public_id` sin extensión: se entregaban con una URL
firmada de la CDN que NO vence (el vencimiento real de la CDN depende de
`cloudinary_auth_token_key`, una función de cuenta). El script firma la URL de
CDN del asset viejo, baja los bytes, los re-sube como `raw/authenticated` con
el `public_id` + extensión, persiste el nuevo `public_id` y destruye el viejo.

Mismo criterio de mocking que `test_migrar_fotos_perfil_autenticadas.py`:
ningún test toca la red. Se parchean en el módulo del script
`cloudinary.uploader.upload`, `cloudinary.uploader.destroy` y `httpx.get`.
Contratos que fijan estos tests:

  - Dry-run POR DEFECTO: sin `ejecutar=True` no hay NINGUNA llamada a
    Cloudinary ni de red, ni cambio en la base.
  - Idempotencia real: una fila cuyo `public_id` ya lleva extensión nunca se
    vuelve a procesar (re-ejecutar el script no re-sube ni re-destruye).
  - Los bytes se validan con la MISMA firma binaria que la subida.
  - Un fallo en una fila no detiene el resto del lote.
  - Un destroy fallido no revierte la migración de la fila: queda el residuo
    reportado aparte.
"""
from unittest.mock import patch

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago
from app.soporte_transversal.configuracion import settings
from scripts.migrar_imagenes_a_raw import migrar_imagenes
from tests.fabricas_pagos import (
    crear_membresia_orm,
    crear_pago_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
)

_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
_URL_PUBLICA_FOTO = "https://res.cloudinary.com/test/image/upload/perfil_{id}.jpg"


class _RespuestaFalsa:
    """Respuesta mínima de `httpx.get`: solo lo que el script lee."""

    def __init__(self, contenido: bytes, content_type: str):
        self.content = contenido
        self.headers = {"content-type": content_type}

    def raise_for_status(self) -> None:
        return None


def _crear_pago_con_voucher(db_session, cedula, *, voucher_url, voucher_formato="image/jpeg"):
    persona = crear_persona_orm(db_session, cedula)
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    pago = crear_pago_orm(db_session, persona, membresia, EstadoPago.APROBADO)
    pago.voucher_url = voucher_url
    pago.voucher_formato = voucher_formato
    db_session.commit()
    db_session.refresh(pago)
    return pago


def _crear_persona_con_foto(db_session, cedula, valor_foto):
    """`valor_foto` es un callable `(persona) -> str`: el valor sembrado se
    deriva del id REAL de la persona, así el fixture y lo esperado no pueden
    divergir por un `perfil_9` literal desactualizado."""
    persona = crear_persona_orm(db_session, cedula)
    persona.foto_url = valor_foto(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _parchear_sdk():
    return (
        patch("scripts.migrar_imagenes_a_raw.cloudinary.uploader.upload"),
        patch("scripts.migrar_imagenes_a_raw.cloudinary.uploader.destroy"),
        patch("scripts.migrar_imagenes_a_raw.httpx.get"),
    )


# --- Dry-run ---------------------------------------------------------------

def test_dry_run_por_defecto_no_hace_red_ni_cambia_filas(db_session):
    pago = _crear_pago_con_voucher(db_session, cedula_valida(301), voucher_url="voucher-pago-1")
    persona = _crear_persona_con_foto(
        db_session, cedula_valida(302), lambda p: f"perfil_{p.id}|1700000001"
    )

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy, p_get as mock_get:
        resumen = migrar_imagenes(db_session)

    mock_upload.assert_not_called()
    mock_destroy.assert_not_called()
    mock_get.assert_not_called()
    db_session.refresh(pago)
    db_session.refresh(persona)
    assert pago.voucher_url == "voucher-pago-1"
    assert persona.foto_url == f"perfil_{persona.id}|1700000001"
    assert resumen["pendientes"] == 2
    assert resumen["migradas"] == 0


# --- Migración real --------------------------------------------------------

def test_ejecutar_re_sube_como_raw_con_extension_persiste_y_destruye(db_session):
    pago = _crear_pago_con_voucher(db_session, cedula_valida(303), voucher_url="voucher-pago-2")

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy, p_get as mock_get:
        mock_get.return_value = _RespuestaFalsa(_JPEG, "image/jpeg")
        mock_upload.return_value = {"secure_url": "https://cdn.test/nueva", "version": 7}
        resumen = migrar_imagenes(db_session, ejecutar=True)

    # 1. El asset viejo se baja por la CDN firmada (`image/authenticated`).
    url_firmada = mock_get.call_args.args[0]
    assert url_firmada.startswith("https://res.cloudinary.com/")
    assert "/image/authenticated/" in url_firmada

    # 2. Se re-sube como `raw/authenticated` con la extensión en el `public_id`.
    _, kwargs = mock_upload.call_args
    assert mock_upload.call_args.args[0] == _JPEG
    assert kwargs["resource_type"] == "raw"
    assert kwargs["type"] == "authenticated"
    assert kwargs["public_id"] == "voucher-pago-2.jpg"
    assert kwargs["folder"] == settings.cloudinary_carpeta_vouchers
    assert kwargs["overwrite"] is True

    # 3. La fila pasa a persistir el `public_id` real (con extensión).
    db_session.refresh(pago)
    assert pago.voucher_url == "voucher-pago-2.jpg"
    assert pago.voucher_formato == "image/jpeg"

    # 4. El asset viejo se destruye con su `resource_type`/`type` originales.
    destroy_args, destroy_kwargs = mock_destroy.call_args
    assert destroy_args[0] == f"{settings.cloudinary_carpeta_vouchers}/voucher-pago-2"
    assert destroy_kwargs["resource_type"] == "image"
    assert destroy_kwargs["type"] == "authenticated"

    assert resumen["migradas"] == 1
    assert resumen["fallidas"] == 0


def test_ejecutar_migra_la_foto_de_perfil_conservando_el_version_compuesto(db_session):
    persona = _crear_persona_con_foto(
        db_session, cedula_valida(304), lambda p: f"perfil_{p.id}|1700000001"
    )

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy, p_get as mock_get:
        mock_get.return_value = _RespuestaFalsa(_PNG, "image/png")
        mock_upload.return_value = {"secure_url": "https://cdn.test/nueva", "version": 1700000002}
        resumen = migrar_imagenes(db_session, ejecutar=True)

    _, kwargs = mock_upload.call_args
    assert kwargs["public_id"] == f"perfil_{persona.id}.png"
    assert kwargs["folder"] == settings.cloudinary_carpeta_fotos_perfil

    db_session.refresh(persona)
    assert persona.foto_url == f"perfil_{persona.id}.png|1700000002"

    destroy_args, destroy_kwargs = mock_destroy.call_args
    assert destroy_args[0] == f"{settings.cloudinary_carpeta_fotos_perfil}/perfil_{persona.id}"
    assert destroy_kwargs["resource_type"] == "image"
    assert destroy_kwargs["type"] == "authenticated"
    assert resumen["migradas"] == 1


def test_sin_version_del_vendor_persiste_el_public_id_solo(db_session):
    """El `version` es opcional en el valor persistido (`|` no hace falta para
    resolver la entrega de un `raw`): si el proveedor no lo devuelve, el script
    guarda el `public_id` a secas en vez de reventar la fila."""
    persona = _crear_persona_con_foto(
        db_session, cedula_valida(305), lambda p: f"perfil_{p.id * 10 + 1}"
    )

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy, p_get as mock_get:
        mock_get.return_value = _RespuestaFalsa(_JPEG, "image/jpeg")
        mock_upload.return_value = {"secure_url": "https://cdn.test/nueva"}

        migrar_imagenes(db_session, ejecutar=True)

    db_session.refresh(persona)
    assert persona.foto_url == f"perfil_{persona.id * 10 + 1}.jpg"


# --- Idempotencia y alcance ------------------------------------------------

def test_fila_ya_migrada_no_se_vuelve_a_tocar(db_session):
    pago = _crear_pago_con_voucher(db_session, cedula_valida(306), voucher_url="voucher-pago-3.jpg")
    persona = _crear_persona_con_foto(
        db_session, cedula_valida(307), lambda p: f"perfil_{p.id}.png|1700000003"
    )

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy, p_get as mock_get:
        resumen = migrar_imagenes(db_session, ejecutar=True)

    mock_upload.assert_not_called()
    mock_destroy.assert_not_called()
    mock_get.assert_not_called()
    db_session.refresh(pago)
    db_session.refresh(persona)
    assert pago.voucher_url == "voucher-pago-3.jpg"
    assert persona.foto_url == f"perfil_{persona.id}.png|1700000003"
    assert resumen["ya_migradas"] == 2
    assert resumen["migradas"] == 0
    assert resumen["pendientes"] == 0


def test_voucher_pdf_no_es_objetivo_de_esta_migracion(db_session):
    """El PDF ya se sube como `raw/authenticated` y su entrega ya vence: no
    hay nada que convertir, y re-subirlo sería un riesgo sin beneficio."""
    _crear_pago_con_voucher(
        db_session, cedula_valida(308), voucher_url="voucher-pago-4", voucher_formato="application/pdf",
    )

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy, p_get:
        resumen = migrar_imagenes(db_session, ejecutar=True)

    mock_upload.assert_not_called()
    assert resumen["pendientes"] == 0
    assert resumen["ya_migradas"] == 1


def test_fila_con_url_publica_heredada_se_reporta_y_no_se_toca(db_session):
    """Las filas `type="upload"` públicas son otro hallazgo (issue #553) con su
    propio script: esta migración las cuenta aparte y no las toca."""
    persona = _crear_persona_con_foto(
        db_session, cedula_valida(309), lambda p: _URL_PUBLICA_FOTO.format(id=p.id),
    )

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy, p_get:
        resumen = migrar_imagenes(db_session, ejecutar=True)

    mock_upload.assert_not_called()
    db_session.refresh(persona)
    assert persona.foto_url == _URL_PUBLICA_FOTO.format(id=persona.id)
    assert resumen["url_publicas_heredadas"] == 1
    assert resumen["pendientes"] == 0


# --- Validación de los bytes -------------------------------------------------

def test_asset_que_no_es_una_imagen_valida_falla_sin_re_subir(db_session):
    """El `content-type` que devuelve el proveedor es tan declarativo como el
    que manda un cliente: manda la firma binaria (misma validación que la
    subida, decisión de diseño 2.3)."""
    pago = _crear_pago_con_voucher(db_session, cedula_valida(310), voucher_url="voucher-pago-5")

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy, p_get as mock_get:
        mock_get.return_value = _RespuestaFalsa(b"no-soy-una-imagen", "image/jpeg")

        resumen = migrar_imagenes(db_session, ejecutar=True)

    mock_upload.assert_not_called()
    mock_destroy.assert_not_called()
    db_session.refresh(pago)
    assert pago.voucher_url == "voucher-pago-5"
    assert resumen["fallidas"] == 1
    assert resumen["migradas"] == 0


def test_content_type_inesperado_falla_sin_re_subir(db_session):
    pago = _crear_pago_con_voucher(db_session, cedula_valida(311), voucher_url="voucher-pago-6")

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy, p_get as mock_get:
        mock_get.return_value = _RespuestaFalsa(b"%PDF-1.4\n", "application/pdf")

        resumen = migrar_imagenes(db_session, ejecutar=True)

    mock_upload.assert_not_called()
    db_session.refresh(pago)
    assert pago.voucher_url == "voucher-pago-6"
    assert resumen["fallidas"] == 1


# --- Tolerancia a fallos -----------------------------------------------------

def test_fallo_en_una_fila_no_detiene_el_resto(db_session):
    pago_falla = _crear_pago_con_voucher(db_session, cedula_valida(312), voucher_url="voucher-pago-7")
    pago_ok = _crear_pago_con_voucher(db_session, cedula_valida(313), voucher_url="voucher-pago-8")

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy, p_get as mock_get:
        mock_get.side_effect = [
            Exception("Cloudinary caído"),
            _RespuestaFalsa(_JPEG, "image/jpeg"),
        ]
        mock_upload.return_value = {"secure_url": "https://cdn.test/nueva", "version": 5}

        resumen = migrar_imagenes(db_session, ejecutar=True)

    assert resumen["fallidas"] == 1
    assert resumen["migradas"] == 1
    db_session.refresh(pago_falla)
    db_session.refresh(pago_ok)
    assert pago_falla.voucher_url == "voucher-pago-7"
    assert pago_ok.voucher_url == "voucher-pago-8.jpg"


def test_destroy_fallido_no_revierte_la_migracion_de_la_fila(db_session):
    """Si la re-subida y la persistencia salieron bien pero el destroy del
    asset viejo falla, la fila queda migrada (ya se sirve por el endpoint que
    vence) y el residuo se reporta aparte para re-correr el script."""
    pago = _crear_pago_con_voucher(db_session, cedula_valida(314), voucher_url="voucher-pago-9")

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy, p_get as mock_get:
        mock_get.return_value = _RespuestaFalsa(_JPEG, "image/jpeg")
        mock_upload.return_value = {"secure_url": "https://cdn.test/nueva", "version": 5}
        mock_destroy.side_effect = Exception("destroy caído")

        resumen = migrar_imagenes(db_session, ejecutar=True)

    db_session.refresh(pago)
    assert pago.voucher_url == "voucher-pago-9.jpg"
    assert resumen["migradas"] == 1
    assert resumen["residuos_antiguos"] == 1


def test_reintento_tras_fallo_de_destroy_no_vuelve_a_tocar_el_recurso_nuevo(db_session):
    """Re-ejecutar el script (lo que el residuo pide) no re-sube ni vuelve a
    bajar nada: el `public_id` persistido ya lleva extensión, así que la fila
    se cuenta como ya migrada y el lote queda vacío."""
    pago = _crear_pago_con_voucher(db_session, cedula_valida(315), voucher_url="voucher-pago-10")

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy, p_get as mock_get:
        mock_get.return_value = _RespuestaFalsa(_JPEG, "image/jpeg")
        mock_upload.return_value = {"secure_url": "https://cdn.test/nueva", "version": 5}
        mock_destroy.side_effect = Exception("destroy caído")

        primera = migrar_imagenes(db_session, ejecutar=True)

    assert primera["migradas"] == 1
    assert primera["residuos_antiguos"] == 1
    db_session.refresh(pago)
    assert pago.voucher_url == "voucher-pago-10.jpg"

    p_upload, p_destroy, p_get = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy, p_get as mock_get:
        segunda = migrar_imagenes(db_session, ejecutar=True)

    mock_upload.assert_not_called()
    mock_destroy.assert_not_called()
    mock_get.assert_not_called()
    assert segunda["ya_migradas"] == 1
    assert segunda["migradas"] == 0
    assert segunda["pendientes"] == 0
