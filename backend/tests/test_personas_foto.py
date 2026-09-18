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

import app.infraestructura.cloudinary_cliente as cc
from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona
from app.seguridad.gestor_auth import GestorAutenticacion


_FAKE_FOTO_URL = "https://res.cloudinary.com/test/image/upload/perfil-fake.jpg"
_FAKE_VERSION = 1700000000  # issue #662: subir_foto_perfil devuelve `version`, no URL
_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100  # JPEG-ish


class _RelojFalso:
    """Reloj inyectable: parchear `time.time` global cambiaría también el
    `timestamp` que calcula el SDK al firmar."""

    def __init__(self, valor: float):
        self.valor = valor

    def time(self) -> float:
        return self.valor


def _assert_url_firmada_de_perfil(url, persona_id, extension=None, version=None):
    """Issue #553 (Problema 2): la respuesta HTTP lleva una URL de entrega
    FIRMADA para el recurso `type="authenticated"` -- nunca el `public_id`
    crudo ni la URL que devolvió el SDK al subir.

    Issue #1072: la foto se entrega por el endpoint de descarga de la API
    (`api.cloudinary.com/.../raw/download`), no por la CDN, así que la carpeta
    y el `public_id` se leen DECODIFICADOS del query string (misma razón que en
    `test_cloudinary_cliente._parametros`: buscarlos como substring de la URL
    cruda no encuentra nada aunque estén).

    `extension` fija la extensión con la que tiene que viajar el `public_id`
    (`perfil_{persona_id}.jpg`): el recurso `raw` la lleva dentro del nombre, y
    firmarlo sin ella daría 404.
    """
    from urllib.parse import parse_qs, urlparse

    from app.soporte_transversal.configuracion import settings

    assert url is not None
    assert "res.cloudinary.com" not in url
    assert url.startswith("https://api.cloudinary.com/v1_1/")
    parametros = parse_qs(urlparse(url).query)
    assert parametros["type"] == ["authenticated"]
    public_id_esperado = f"{settings.cloudinary_carpeta_fotos_perfil}/perfil_{persona_id}"
    if extension:
        public_id_esperado = f"{public_id_esperado}.{extension}"
    assert parametros["public_id"][0] == public_id_esperado
    assert parametros["expires_at"]
    # Issue #662: el `version` ya no viaja en la URL (la cambia el propio
    # `expires_at` en cada firma), así que se exige lo contrario de antes.
    if version is not None:
        assert f"/v{version}/" not in url


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
    _assert_url_firmada_de_perfil(
        resp.json()["fotoUrl"], dependiente.id, extension="jpg", version=_FAKE_VERSION
    )

    # Issue #1072: el `public_id` REAL de un `raw` lleva la extensión -- es el
    # que se sube y el que se firma al leer (issue #480).
    db_session.refresh(dependiente)
    assert dependiente.foto_url == f"perfil_{dependiente.id}.jpg|{_FAKE_VERSION}"


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
    _assert_url_firmada_de_perfil(
        resp.json()["fotoUrl"], objetivo.id, extension="jpg", version=_FAKE_VERSION
    )

    db_session.refresh(objetivo)
    assert objetivo.foto_url == f"perfil_{objetivo.id}.jpg|{_FAKE_VERSION}"


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
    _assert_url_firmada_de_perfil(
        resp.json()["fotoUrl"], persona.id, extension="jpg", version=_FAKE_VERSION
    )

    db_session.refresh(persona)
    assert persona.foto_url == f"perfil_{persona.id}.jpg|{_FAKE_VERSION}"


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
    voucher de pago, `resolver_url_entrega`).

    El `public_id` se siembra CON extensión (shape que escriben las subidas
    nuevas, issue #1072) porque es el que existe en Cloudinary como `raw`; la
    variante sin extensión (filas previas a ese fix, todavía sin migrar) se
    cubre en `test_cloudinary_cliente.py`."""
    admin = _crear_persona(db_session, cedula_valida(212), "Admin")
    objetivo = _crear_persona(db_session, cedula_valida(213), "Nadia")
    objetivo.foto_url = f"perfil_{objetivo.id}.jpg"
    db_session.commit()
    _restaurar_override_token(admin.id, ["ADMINISTRADOR"])

    resp = client.get(f"/api/v1/personas/{objetivo.id}")
    assert resp.status_code == 200, resp.text
    _assert_url_firmada_de_perfil(resp.json()["fotoUrl"], objetivo.id, extension="jpg")


# --- Issue #662: reemplazar la foto de una persona debe cambiar la URL ----
# Mismo hallazgo que en el self-service (`test_auth_perfil_propio.py`): el
# `public_id` es determinístico y el upload usa `overwrite=True`, así que sin
# ALGO que cambie entre subidas la URL de entrega firmada queda
# byte-idéntica y el navegador sigue mostrando la foto vieja tras un
# reemplazo real.
#
# Issue #1072: ese ALGO es el `timestamp`/`expires_at` que el endpoint de
# descarga firma en cada lectura, con resolución de UN segundo -- por eso el
# reloj se inyecta y se avanza entre las dos subidas.
@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    side_effect=[1700000101, 1700000102],
)
def test_reemplazar_foto_de_persona_produce_una_url_distinta_a_la_anterior(
    _mock_cloudinary, client, db_session, monkeypatch
):
    admin = _crear_persona(db_session, cedula_valida(214), "Admin")
    objetivo = _crear_persona(db_session, cedula_valida(215), "Valentina")
    _restaurar_override_token(admin.id, ["ADMINISTRADOR"])

    reloj = _RelojFalso(1_700_000_000.0)
    monkeypatch.setattr(cc, "time", reloj)

    resp_1 = client.post(
        f"/api/v1/personas/{objetivo.id}/foto",
        files={"archivo": ("foto1.jpg", _JPEG, "image/jpeg")},
    )
    assert resp_1.status_code == 200, resp_1.text
    url_original = resp_1.json()["fotoUrl"]
    _assert_url_firmada_de_perfil(url_original, objetivo.id, extension="jpg")

    reloj.valor += 1.0  # el reemplazo ocurre en otro segundo
    resp_2 = client.post(
        f"/api/v1/personas/{objetivo.id}/foto",
        files={"archivo": ("foto2.jpg", _JPEG, "image/jpeg")},
    )
    assert resp_2.status_code == 200, resp_2.text
    url_reemplazada = resp_2.json()["fotoUrl"]
    _assert_url_firmada_de_perfil(url_reemplazada, objetivo.id, extension="jpg")

    assert url_reemplazada != url_original, (
        "reemplazar la foto de una persona debe producir una URL de entrega "
        "distinta a la anterior (issue #662)"
    )


# --- R3-001 (#1072): reemplazar la foto debe destruir la anterior ---------
# Mismo hallazgo que en el self-service (`test_auth_perfil_propio.py`): el
# `public_id` depende del formato subido, así que `overwrite=True` ya no
# garantiza un solo asset vivo por persona.
@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    return_value=_FAKE_VERSION,
)
def test_reemplazar_foto_de_persona_de_jpg_a_png_destruye_la_anterior(
    _mock_cloudinary, client, db_session
):
    admin = _crear_persona(db_session, cedula_valida(218), "Admin")
    objetivo = _crear_persona(db_session, cedula_valida(219), "Pilar")
    objetivo.foto_url = f"perfil_{objetivo.id}.jpg|{_FAKE_VERSION}"
    db_session.commit()
    _restaurar_override_token(admin.id, ["ADMINISTRADOR"])

    contenido = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100  # PNG-ish
    with patch("app.infraestructura.cloudinary_cliente.cloudinary.uploader.destroy") as mock_destroy:
        resp = client.post(
            f"/api/v1/personas/{objetivo.id}/foto",
            files={"archivo": ("foto.png", contenido, "image/png")},
        )
    assert resp.status_code == 200, resp.text

    from app.soporte_transversal.configuracion import settings
    clave = f"{settings.cloudinary_carpeta_fotos_perfil}/perfil_{objetivo.id}.jpg"
    borrados = {llamada.args[0]: llamada.kwargs for llamada in mock_destroy.call_args_list}
    assert clave in borrados, list(borrados)
    assert borrados[clave]["resource_type"] == "raw"
    assert borrados[clave]["type"] == "authenticated"


def test_get_persona_foto_previa_al_fix_se_sigue_entregando(client, db_session):
    """Transición del issue #1072: una foto subida antes del fix persiste el
    `public_id` SIN extensión (`perfil_{id}`) bajo `image/authenticated`. Se
    sigue sirviendo por la CDN firmada -- la entrega no puede pedirle al
    endpoint de descarga un recurso `raw` que todavía no existe (404) -- hasta
    que corra `scripts/migrar_imagenes_a_raw.py`, en cualquier orden respecto
    del despliegue."""
    admin = _crear_persona(db_session, cedula_valida(216), "Admin")
    objetivo = _crear_persona(db_session, cedula_valida(217), "Olga")
    objetivo.foto_url = f"perfil_{objetivo.id}"
    db_session.commit()
    _restaurar_override_token(admin.id, ["ADMINISTRADOR"])

    resp = client.get(f"/api/v1/personas/{objetivo.id}")

    assert resp.status_code == 200, resp.text
    url = resp.json()["fotoUrl"]
    assert url.startswith("https://res.cloudinary.com/")
    assert "/image/authenticated/" in url
    assert f"cataclub/fotos_perfil/perfil_{objetivo.id}" in url


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
