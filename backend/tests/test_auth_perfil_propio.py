"""
Tests de perfil propio del usuario autenticado (Issue #36).

Cubre:
  - GET /auth/me ahora incluye `telefono` (persona con y sin teléfono).
  - GET /auth/me y PATCH /auth/me ahora incluyen `fechaCreacion` (fecha de
    creación de la cuenta, `Usuario.fecha_creacion`).
  - PATCH /auth/me (nuevo, self-service):
      * Actualiza solo `telefono` -> no reemite tokens.
      * Ignora `correo` en el payload (no editable -- es el `sub` del JWT).
      * Exige autenticación (401 sin token).
  - POST /auth/me/foto (nuevo, self-service): sube/reemplaza la foto de
    perfil propia.
      * JPEG/PNG válidos -> 200, `fotoUrl` actualizado y reflejado en un
        `GET /auth/me` posterior.
      * Tipo MIME no soportado -> 400 limpio (no 500), sin tocar Cloudinary.
      * Archivo que excede el tamaño máximo -> 400 limpio, sin tocar Cloudinary.
      * Exige autenticación (401 sin token).
      * Cuenta suspendida (`activo=False`) no puede subir.
"""
from datetime import date
from unittest.mock import patch

from app.dominio.modelos import Usuario, Rol
from app.dominio.enums import TipoRol
from app.seguridad.gestor_auth import GestorAutenticacion


def _fecha_creacion_iso_esperada(usuario: Usuario) -> str:
    """Formato ISO 8601 real que produce `ResponseBase` para un DTO servido a
    través de FastAPI (`response_model=...`).

    El gap que documentaba la versión anterior de este helper ("el sufijo 'Z'
    nunca se agrega") era un SÍNTOMA del bug de zona horaria, no un problema
    de `base.py`: `usuario.fecha_creacion` era naive porque la columna era
    `timestamp without time zone`, y pydantic serializa un datetime naive sin
    ningún offset — el navegador lo interpretaba como hora LOCAL y mostraba
    una diferencia de 5 horas.

    Desde que la columna es `timestamptz` (migración `a7c1e9d4f6b2`) el valor
    llega aware y pydantic emite el offset por sí solo ('Z' cuando la sesión
    de BD está en UTC, como en los contenedores). `isoformat()` sobre el
    valor aware describe ese mismo instante."""
    return usuario.fecha_creacion.isoformat().replace("+00:00", "Z")


# --- helpers (mismo patrón que test_auth_registro_refresh.py) ---------------
def _crear_persona(db_session, cedula="1710034065", nombres="Ana", telefono="0991234567"):
    from app.dominio.modelos import Persona
    p = Persona(
        nombres=nombres, apellidos="Torres", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono=telefono,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def _crear_usuario_para_persona(db_session, persona, correo=None, roles=None):
    usuario = Usuario(
        correo=correo or f"{persona.cedula}@cataclub.com",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("clave12345"),
        persona_id=persona.id,
    )
    if roles:
        for r in roles:
            usuario.roles.append(r)
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _restaurar_override_token(correo="user@cataclub.test", persona_id=1, roles=None):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": correo, "persona_id": persona_id, "roles": roles or [],
    }


# --- GET /auth/me incluye telefono ------------------------------------------
def test_auth_me_incluye_telefono(client, db_session):
    persona = _crear_persona(db_session, cedula="1710034200", nombres="Lucía", telefono="0991234567")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="lucia2@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="lucia2@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["telefono"] == "0991234567"


def test_auth_me_telefono_vacio_si_persona_sin_telefono(client, db_session):
    persona = _crear_persona(db_session, cedula="1710034218", nombres="Marta", telefono="")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="marta@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="marta@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["telefono"] == ""


# --- GET /auth/me incluye fechaCreacion --------------------------------------
def test_auth_me_incluye_fecha_creacion(client, db_session):
    persona = _crear_persona(db_session, cedula="1710034267", nombres="Rosa", telefono="0991234567")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    usuario = _crear_usuario_para_persona(db_session, persona, correo="rosa@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="rosa@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["fechaCreacion"] == _fecha_creacion_iso_esperada(usuario)


# --- PATCH /auth/me -----------------------------------------------------------
def test_patch_perfil_actualiza_telefono_sin_reemitir_tokens(client, db_session):
    persona = _crear_persona(db_session, cedula="1710034226", nombres="Sofía", telefono="0991111111")
    rol_entrenador = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")
    _crear_usuario_para_persona(db_session, persona, correo="sofia@cataclub.com", roles=[rol_entrenador])
    _restaurar_override_token(correo="sofia@cataclub.com", persona_id=persona.id, roles=["ENTRENADOR"])

    resp = client.patch("/api/v1/auth/me", json={"telefono": "0992222222"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["telefono"] == "0992222222"
    assert body["correo"] == "sofia@cataclub.com"
    assert not body.get("accessToken")
    assert not body.get("refreshToken")

    db_session.refresh(persona)
    assert persona.telefono == "0992222222"


def test_patch_perfil_ignora_correo_en_el_payload(client, db_session):
    """`ActualizarPerfilPropioDTO` no declara `correo` -- Pydantic descarta
    silenciosamente el campo desconocido (comportamiento default `extra`),
    así que un intento de cambiarlo no tiene ningún efecto: ni lo persiste
    ni reemite tokens. Correo es el `sub` del JWT; editarlo self-service fue
    removido por diseño."""
    persona = _crear_persona(db_session, cedula="1710034234", nombres="Diego", telefono="0993333333")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    usuario = _crear_usuario_para_persona(db_session, persona, correo="diego.viejo@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="diego.viejo@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.patch(
        "/api/v1/auth/me",
        json={"correo": "diego.nuevo@cataclub.com", "telefono": "0998888888"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["correo"] == "diego.viejo@cataclub.com"
    assert body["telefono"] == "0998888888"
    assert not body.get("accessToken")
    assert not body.get("refreshToken")

    db_session.refresh(usuario)
    assert usuario.correo == "diego.viejo@cataclub.com"


def test_patch_perfil_requiere_autenticacion(client_sin_token):
    resp = client_sin_token.patch("/api/v1/auth/me", json={"telefono": "0996666666"})
    assert resp.status_code == 401


# --- PATCH /auth/me incluye fechaCreacion ------------------------------------
def test_patch_perfil_incluye_fecha_creacion(client, db_session):
    persona = _crear_persona(db_session, cedula="1710034275", nombres="Iván", telefono="0997777777")
    rol_entrenador = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")
    usuario = _crear_usuario_para_persona(db_session, persona, correo="ivan@cataclub.com", roles=[rol_entrenador])
    _restaurar_override_token(correo="ivan@cataclub.com", persona_id=persona.id, roles=["ENTRENADOR"])

    resp = client.patch("/api/v1/auth/me", json={"telefono": "0998888888"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["fechaCreacion"] == _fecha_creacion_iso_esperada(usuario)


# --- POST /auth/me/foto -------------------------------------------------------
# Igual criterio de mocking que test_voucher_pago.py: la subida real a
# Cloudinary no está disponible en el entorno de test, así que se mockea
# `app.infraestructura.cloudinary_cliente.subir_foto_perfil` y se prueba solo
# la lógica de validación + persistencia de este módulo.
_FAKE_FOTO_URL_JPG = "https://res.cloudinary.com/test/image/upload/perfil-fake.jpg"
_FAKE_FOTO_URL_PNG = "https://res.cloudinary.com/test/image/upload/perfil-fake.png"


@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    return_value=_FAKE_FOTO_URL_JPG,
)
def test_subir_foto_perfil_jpg_actualiza_foto_url_y_se_refleja_en_get(_mock_cloudinary, client, db_session):
    persona = _crear_persona(db_session, cedula="1710034283", nombres="Paola", telefono="0991112223")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="paola@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="paola@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100  # JPEG-ish
    resp = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["fotoUrl"] == _FAKE_FOTO_URL_JPG

    resp_get = client.get("/api/v1/auth/me")
    assert resp_get.status_code == 200, resp_get.text
    assert resp_get.json()["fotoUrl"] == _FAKE_FOTO_URL_JPG


@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    return_value=_FAKE_FOTO_URL_PNG,
)
def test_subir_foto_perfil_png_actualiza_foto_url(_mock_cloudinary, client, db_session):
    persona = _crear_persona(db_session, cedula="1710034291", nombres="Renata", telefono="0991112224")
    rol_entrenador = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")
    _crear_usuario_para_persona(db_session, persona, correo="renata@cataclub.com", roles=[rol_entrenador])
    _restaurar_override_token(correo="renata@cataclub.com", persona_id=persona.id, roles=["ENTRENADOR"])

    contenido = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100  # PNG-ish
    resp = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.png", contenido, "image/png")},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["fotoUrl"] == _FAKE_FOTO_URL_PNG


def test_subir_foto_perfil_tipo_no_permitido_da_400(client, db_session):
    persona = _crear_persona(db_session, cedula="1710034309", nombres="Bruno", telefono="0991112225")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="bruno@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="bruno@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("archivo.pdf", b"%PDF-1.4\n" + b"\x00" * 100, "application/pdf")},
    )
    assert resp.status_code == 400
    assert "formato" in resp.json()["detail"].lower()


@patch("app.infraestructura.cloudinary_cliente.subir_foto_perfil")
def test_subir_foto_perfil_firma_no_coincide_con_content_type_da_400(_mock_cloudinary, client, db_session):
    """Declara `image/jpeg` pero el contenido real no tiene la firma binaria
    de un JPEG -- debe rechazarse ANTES de llamar a Cloudinary
    (REQ-SEC-3, sdd/production-readiness)."""
    persona = _crear_persona(db_session, cedula="1710034333", nombres="Elena", telefono="0991112228")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="elena@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="elena@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    contenido = b"esto no es una imagen real" + b"\x00" * 50
    resp = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )
    assert resp.status_code == 400
    assert "no coincide" in resp.json()["detail"].lower()
    _mock_cloudinary.assert_not_called()


def test_subir_foto_perfil_excede_tamano_maximo_da_400(client, db_session):
    persona = _crear_persona(db_session, cedula="1710034317", nombres="Camila", telefono="0991112226")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="camila@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="camila@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    contenido_grande = b"\xff\xd8\xff\xe0" + b"\x00" * (5 * 1024 * 1024 + 1)  # > 5MB
    resp = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.jpg", contenido_grande, "image/jpeg")},
    )
    assert resp.status_code == 400
    assert "tamaño" in resp.json()["detail"].lower()


def test_subir_foto_perfil_requiere_autenticacion(client_sin_token):
    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
    resp = client_sin_token.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )
    assert resp.status_code == 401


def test_subir_foto_perfil_cuenta_suspendida_no_puede_subir(client, db_session):
    persona = _crear_persona(db_session, cedula="1710034325", nombres="Diana", telefono="0991112227")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    usuario = _crear_usuario_para_persona(db_session, persona, correo="diana@cataclub.com", roles=[rol_admin])
    usuario.activo = False
    db_session.add(usuario)
    db_session.commit()
    _restaurar_override_token(correo="diana@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
    resp = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )
    assert resp.status_code == 401
