"""
Tests de la carga de foto de una persona (issue #286, slice 1).

Cubre `POST /personas/{persona_id}/foto`, que extiende el self-service de
`POST /auth/me/foto` a una Persona OBJETIVO: la propia persona, su
representante legal, o un ADMINISTRADOR pueden subir/reemplazar la foto.

El permiso usa `PoliticaAccesoPersona.exigir_acceso` con
`roles_privilegiados=SOLO_ADMINISTRADOR` (dueño + representante del objetivo +
admin) — NO `exigir_acceso_directo`, que excluye la rama del representante.

Mismo criterio de mocking que test_auth_perfil_propio.py: la subida real a
Cloudinary no está disponible en el entorno de test, así que se mockea
`app.infraestructura.cloudinary_cliente.subir_foto_perfil` y se prueba solo la
lógica de permiso + validación + persistencia.
"""
from datetime import date
from unittest.mock import patch

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona
from app.seguridad.gestor_auth import GestorAutenticacion


_FAKE_FOTO_URL = "https://res.cloudinary.com/test/image/upload/perfil-fake.jpg"
_FAKE_VERSION = 1700000000  # issue #662: subir_foto_perfil devuelve `version`, no URL
_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100  # JPEG-ish


def _assert_url_firmada_de_perfil(url, persona_id, version=None):
    """Issue #553 (Problema 2): la respuesta HTTP lleva una URL de entrega
    FIRMADA para el recurso `type="authenticated"` -- nunca el `public_id`
    crudo ni la URL que devolvió el SDK al subir. Issue #662: si se pasa
    `version`, exige además que la URL lleve ese `version` embebido -- es lo
    que la vuelve DISTINTA de la URL de una subida anterior."""
    from app.soporte_transversal.configuracion import settings

    assert url is not None
    assert "/authenticated/" in url
    assert f"{settings.cloudinary_carpeta_fotos_perfil}/perfil_{persona_id}" in url
    if version is not None:
        assert f"/v{version}/" in url


def _crear_persona(db_session, cedula, nombres, representante_id=None, fecha_nacimiento=None):
    p = Persona(
        nombres=nombres,
        apellidos="Test",
        cedula=cedula,
        fecha_nacimiento=fecha_nacimiento or date(1990, 1, 1),
        telefono="0991234567",
        representante_id=representante_id,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def _restaurar_override_token(persona_id, roles):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "usuario@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    return_value=_FAKE_VERSION,
)
def test_representante_subir_foto_de_representado(_mock_cloudinary, client, db_session):
    representante = _crear_persona(db_session, cedula_valida(200), "Laura")
    dependiente = _crear_persona(
        db_session, cedula_valida(201), "Sofía",
        representante_id=representante.id, fecha_nacimiento=date(2014, 1, 1),
    )
    _restaurar_override_token(representante.id, ["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{dependiente.id}/foto",
        files={"archivo": ("foto.jpg", _JPEG, "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    _assert_url_firmada_de_perfil(resp.json()["fotoUrl"], dependiente.id, version=_FAKE_VERSION)

    db_session.refresh(dependiente)
    assert dependiente.foto_url == f"perfil_{dependiente.id}|{_FAKE_VERSION}"


@patch("app.infraestructura.cloudinary_cliente.subir_foto_perfil")
def test_no_representante_da_403(_mock_cloudinary, client, db_session):
    representante_a = _crear_persona(db_session, cedula_valida(202), "Laura")
    representante_b = _crear_persona(db_session, cedula_valida(203), "Carlos")
    dependiente = _crear_persona(
        db_session, cedula_valida(204), "Sofía",
        representante_id=representante_a.id, fecha_nacimiento=date(2014, 1, 1),
    )
    _restaurar_override_token(representante_b.id, ["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{dependiente.id}/foto",
        files={"archivo": ("foto.jpg", _JPEG, "image/jpeg")},
    )
    assert resp.status_code == 403
    _mock_cloudinary.assert_not_called()


@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    return_value=_FAKE_VERSION,
)
def test_admin_subir_foto_de_cualquier_persona(_mock_cloudinary, client, db_session):
    admin = _crear_persona(db_session, cedula_valida(205), "Admin")
    objetivo = _crear_persona(db_session, cedula_valida(206), "Bruno")
    _restaurar_override_token(admin.id, ["ADMINISTRADOR"])

    resp = client.post(
        f"/api/v1/personas/{objetivo.id}/foto",
        files={"archivo": ("foto.jpg", _JPEG, "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    _assert_url_firmada_de_perfil(resp.json()["fotoUrl"], objetivo.id, version=_FAKE_VERSION)

    db_session.refresh(objetivo)
    assert objetivo.foto_url == f"perfil_{objetivo.id}|{_FAKE_VERSION}"


@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    return_value=_FAKE_VERSION,
)
def test_titular_subir_su_propia_foto(_mock_cloudinary, client, db_session):
    persona = _crear_persona(db_session, cedula_valida(207), "Ana")
    _restaurar_override_token(persona.id, ["ALUMNO"])

    resp = client.post(
        f"/api/v1/personas/{persona.id}/foto",
        files={"archivo": ("foto.jpg", _JPEG, "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    _assert_url_firmada_de_perfil(resp.json()["fotoUrl"], persona.id, version=_FAKE_VERSION)

    db_session.refresh(persona)
    assert persona.foto_url == f"perfil_{persona.id}|{_FAKE_VERSION}"


def test_get_persona_foto_heredada_url_publica_se_devuelve_sin_tocar(client, db_session):
    """Compatibilidad durante la transición (issue #553): una foto subida
    ANTES del fix persiste la `secure_url` pública completa en
    `Persona.foto_url`; los `PersonaResponseDTO` la devuelven tal cual hasta
    que el operador corra `scripts/migrar_fotos_perfil_autenticadas.py`."""
    admin = _crear_persona(db_session, cedula_valida(210), "Admin")
    objetivo = _crear_persona(db_session, cedula_valida(211), "Elsa")
    objetivo.foto_url = _FAKE_FOTO_URL
    db_session.commit()
    _restaurar_override_token(admin.id, ["ADMINISTRADOR"])

    resp = client.get(f"/api/v1/personas/{objetivo.id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["fotoUrl"] == _FAKE_FOTO_URL


def test_get_persona_foto_migrada_se_firma_en_la_respuesta(client, db_session):
    """La fila migrada persiste el `public_id`; el DTO de respuesta firma la
    URL de entrega fresca en cada lectura autorizada (mismo patrón que el
    voucher de pago, `resolver_url_entrega`)."""
    admin = _crear_persona(db_session, cedula_valida(212), "Admin")
    objetivo = _crear_persona(db_session, cedula_valida(213), "Nadia")
    objetivo.foto_url = f"perfil_{objetivo.id}"
    db_session.commit()
    _restaurar_override_token(admin.id, ["ADMINISTRADOR"])

    resp = client.get(f"/api/v1/personas/{objetivo.id}")
    assert resp.status_code == 200, resp.text
    _assert_url_firmada_de_perfil(resp.json()["fotoUrl"], objetivo.id)


# --- Issue #662: reemplazar la foto de una persona debe cambiar la URL ----
# Mismo hallazgo que en el self-service (`test_auth_perfil_propio.py`): el
# `public_id` es determinístico y el upload usa `overwrite=True`, así que sin
# ALGO que cambie entre subidas la URL de entrega firmada queda
# byte-idéntica y el navegador sigue mostrando la foto vieja tras un
# reemplazo real.
@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    side_effect=[1700000101, 1700000102],
)
def test_reemplazar_foto_de_persona_produce_una_url_distinta_a_la_anterior(_mock_cloudinary, client, db_session):
    admin = _crear_persona(db_session, cedula_valida(214), "Admin")
    objetivo = _crear_persona(db_session, cedula_valida(215), "Valentina")
    _restaurar_override_token(admin.id, ["ADMINISTRADOR"])

    resp_1 = client.post(
        f"/api/v1/personas/{objetivo.id}/foto",
        files={"archivo": ("foto1.jpg", _JPEG, "image/jpeg")},
    )
    assert resp_1.status_code == 200, resp_1.text
    url_original = resp_1.json()["fotoUrl"]
    _assert_url_firmada_de_perfil(url_original, objetivo.id)

    resp_2 = client.post(
        f"/api/v1/personas/{objetivo.id}/foto",
        files={"archivo": ("foto2.jpg", _JPEG, "image/jpeg")},
    )
    assert resp_2.status_code == 200, resp_2.text
    url_reemplazada = resp_2.json()["fotoUrl"]
    _assert_url_firmada_de_perfil(url_reemplazada, objetivo.id)

    assert url_reemplazada != url_original, (
        "reemplazar la foto de una persona debe producir una URL de entrega "
        "distinta a la anterior (issue #662)"
    )


def test_falta_archivo_da_422(client, db_session):
    persona = _crear_persona(db_session, cedula_valida(208), "Ana")
    _restaurar_override_token(persona.id, ["ALUMNO"])

    resp = client.post(f"/api/v1/personas/{persona.id}/foto")
    assert resp.status_code == 422


@patch("app.infraestructura.cloudinary_cliente.subir_foto_perfil")
def test_tipo_no_permitido_da_400(_mock_cloudinary, client, db_session):
    persona = _crear_persona(db_session, cedula_valida(209), "Ana")
    _restaurar_override_token(persona.id, ["ALUMNO"])

    resp = client.post(
        f"/api/v1/personas/{persona.id}/foto",
        files={"archivo": ("archivo.pdf", b"%PDF-1.4\n" + b"\x00" * 100, "application/pdf")},
    )
    assert resp.status_code == 400
    assert "formato" in resp.json()["detail"].lower()
    _mock_cloudinary.assert_not_called()
