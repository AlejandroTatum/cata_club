"""
Tests del script one-off `scripts/migrar_fotos_perfil_autenticadas.py`
(issue #553, Problema 2).

Las fotos de perfil subidas ANTES del fix son recursos `type="upload"`
públicos y enumerables (`perfil_{persona_id}` bajo la carpeta de fotos).
El script las re-sube como `type="authenticated"`, persiste el `public_id`
en `Persona.foto_url` y destruye el recurso público original.

Mismo criterio de mocking que `test_cloudinary_cliente.py`: ningún test toca
la red; se parchean `cloudinary.uploader.upload` y `cloudinary.uploader.
destroy` en el módulo del script. Contratos que fijan estos tests:

  - Dry-run POR DEFECTO: sin `ejecutar=True` no hay NINGUNA llamada a
    Cloudinary ni cambio en la base (misma convención que
    `scripts/reset_dev_db.py --dry-run`).
  - Idempotencia: una fila que ya persiste el `public_id` nunca se re-sube.
  - Un fallo en una foto no detiene el resto del lote.
"""
from datetime import date
from unittest.mock import patch

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona
from app.soporte_transversal.configuracion import settings
from scripts.migrar_fotos_perfil_autenticadas import migrar_fotos


_URL_PUBLICA = "https://res.cloudinary.com/test/image/upload/v1/cataclub/fotos_perfil/perfil_{id}.jpg"


def _crear_persona(db_session, indice, foto_url=None):
    p = Persona(
        nombres=f"Persona{indice}",
        apellidos="Migrada",
        cedula=cedula_valida(indice),
        fecha_nacimiento=date(1990, 1, 1),
        telefono="0991234567",
        foto_url=foto_url,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def _parchear_sdk():
    return (
        patch("scripts.migrar_fotos_perfil_autenticadas.cloudinary.uploader.upload"),
        patch("scripts.migrar_fotos_perfil_autenticadas.cloudinary.uploader.destroy"),
    )


def test_dry_run_por_defecto_no_llama_a_cloudinary_ni_cambia_filas(db_session):
    persona = _crear_persona(db_session, 620)
    persona.foto_url = _URL_PUBLICA.format(id=persona.id)
    db_session.commit()

    p_upload, p_destroy = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy:
        resumen = migrar_fotos(db_session)

    mock_upload.assert_not_called()
    mock_destroy.assert_not_called()
    db_session.refresh(persona)
    assert persona.foto_url == _URL_PUBLICA.format(id=persona.id)
    assert resumen["pendientes"] == 1
    assert resumen["migradas"] == 0


def test_ejecutar_re_sube_como_authenticated_persiste_public_id_y_destruye(db_session):
    persona = _crear_persona(db_session, 621)
    url_original = _URL_PUBLICA.format(id=persona.id)
    persona.foto_url = url_original
    db_session.commit()

    p_upload, p_destroy = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy:
        mock_upload.return_value = {"secure_url": "https://cdn.test/nueva"}
        resumen = migrar_fotos(db_session, ejecutar=True)

    # Re-subida: Cloudinary descarga la URL pública original server-side.
    args, kwargs = mock_upload.call_args
    assert args[0] == url_original
    assert kwargs["type"] == "authenticated"
    assert kwargs["resource_type"] == "image"
    assert kwargs["public_id"] == f"perfil_{persona.id}"
    assert kwargs["folder"] == settings.cloudinary_carpeta_fotos_perfil
    assert kwargs["overwrite"] is True

    # La fila pasa a persistir el `public_id` (patrón voucher).
    db_session.refresh(persona)
    assert persona.foto_url == f"perfil_{persona.id}"

    # El recurso público original se destruye (indexado como
    # `{carpeta}/{public_id}` bajo `type="upload"`, issue #480).
    _, destroy_kwargs = mock_destroy.call_args
    destroy_args, _ = mock_destroy.call_args
    assert destroy_args[0] == (
        f"{settings.cloudinary_carpeta_fotos_perfil}/perfil_{persona.id}"
    )
    assert destroy_kwargs["type"] == "upload"
    assert destroy_kwargs["resource_type"] == "image"

    assert resumen["migradas"] == 1
    assert resumen["fallidas"] == 0


def test_fila_ya_migrada_no_se_vuelve_a_subir(db_session):
    persona = _crear_persona(db_session, 622)
    persona.foto_url = f"perfil_{persona.id}"
    db_session.commit()

    p_upload, p_destroy = _parchear_sdk()
    with p_upload as mock_upload, p_destroy:
        resumen = migrar_fotos(db_session, ejecutar=True)

    mock_upload.assert_not_called()
    db_session.refresh(persona)
    assert persona.foto_url == f"perfil_{persona.id}"
    assert resumen["ya_migradas"] == 1
    assert resumen["migradas"] == 0


def test_persona_sin_foto_se_ignora(db_session):
    _crear_persona(db_session, 623, foto_url=None)

    p_upload, p_destroy = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy:
        resumen = migrar_fotos(db_session, ejecutar=True)

    mock_upload.assert_not_called()
    mock_destroy.assert_not_called()
    assert resumen["migradas"] == 0
    assert resumen["pendientes"] == 0


def test_fallo_en_una_foto_no_detiene_el_resto(db_session):
    persona_a = _crear_persona(db_session, 624)
    persona_a.foto_url = _URL_PUBLICA.format(id=persona_a.id)
    persona_b = _crear_persona(db_session, 625)
    persona_b.foto_url = _URL_PUBLICA.format(id=persona_b.id)
    db_session.commit()

    p_upload, p_destroy = _parchear_sdk()
    with p_upload as mock_upload, p_destroy:
        mock_upload.side_effect = [
            Exception("Cloudinary caído"),
            {"secure_url": "https://cdn.test/nueva"},
        ]
        resumen = migrar_fotos(db_session, ejecutar=True)

    assert resumen["fallidas"] == 1
    assert resumen["migradas"] == 1
    # La que falló conserva su URL pública para el próximo intento.
    db_session.refresh(persona_a)
    db_session.refresh(persona_b)
    fotos = {persona_a.foto_url, persona_b.foto_url}
    assert f"perfil_{persona_b.id}" in fotos or f"perfil_{persona_a.id}" in fotos
    assert any(valor.startswith("https://") for valor in fotos)


def test_destroy_fallido_no_revierte_la_migracion_de_la_fila(db_session):
    """Si la re-subida y la persistencia salieron bien pero el destroy del
    recurso público falla, la fila queda migrada (la foto ya se sirve
    firmada) y el residuo se reporta como fallo para re-correr el script."""
    persona = _crear_persona(db_session, 626)
    persona.foto_url = _URL_PUBLICA.format(id=persona.id)
    db_session.commit()

    p_upload, p_destroy = _parchear_sdk()
    with p_upload as mock_upload, p_destroy as mock_destroy:
        mock_upload.return_value = {"secure_url": "https://cdn.test/nueva"}
        mock_destroy.side_effect = Exception("destroy caído")
        resumen = migrar_fotos(db_session, ejecutar=True)

    db_session.refresh(persona)
    assert persona.foto_url == f"perfil_{persona.id}"
    assert resumen["migradas"] == 1
    assert resumen["residuos_publicos"] == 1
