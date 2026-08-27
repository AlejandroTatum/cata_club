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

from app.dominio.cedula import cedula_valida
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
    persona = _crear_persona(db_session, cedula=cedula_valida(160), nombres="Lucía", telefono="0991234567")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="lucia2@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="lucia2@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["telefono"] == "0991234567"


def test_auth_me_telefono_vacio_si_persona_sin_telefono(client, db_session):
    persona = _crear_persona(db_session, cedula=cedula_valida(161), nombres="Marta", telefono="")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="marta@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="marta@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["telefono"] == ""


# --- GET /auth/me incluye fechaCreacion --------------------------------------
def test_auth_me_incluye_fecha_creacion(client, db_session):
    persona = _crear_persona(db_session, cedula=cedula_valida(162), nombres="Rosa", telefono="0991234567")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    usuario = _crear_usuario_para_persona(db_session, persona, correo="rosa@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="rosa@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["fechaCreacion"] == _fecha_creacion_iso_esperada(usuario)


# --- GET /auth/me incluye fechaNacimiento ------------------------------------
# El frontend necesita esto para decidir, sin una llamada aparte, si un
# alumno autogestionado ("estudiante") es mayor de edad -- el nav
# (getNavLinksForRole) solo puede ofrecer el link a "Ficha médica" cuando lo
# es (ver ficha_medica_router.py::_es_titular_mayor_de_edad, la mitad
# backend de la misma decisión).
def test_auth_me_incluye_fecha_nacimiento(client, db_session):
    persona = _crear_persona(db_session, cedula=cedula_valida(163), nombres="Iván", telefono="0991234567")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="ivan@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="ivan@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["fechaNacimiento"] == persona.fecha_nacimiento.isoformat()


# --- PATCH /auth/me -----------------------------------------------------------
def test_patch_perfil_actualiza_telefono_sin_reemitir_tokens(client, db_session):
    persona = _crear_persona(db_session, cedula=cedula_valida(164), nombres="Sofía", telefono="0991111111")
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
    persona = _crear_persona(db_session, cedula=cedula_valida(165), nombres="Diego", telefono="0993333333")
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
    persona = _crear_persona(db_session, cedula=cedula_valida(166), nombres="Iván", telefono="0997777777")
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
#
# Issue #553 (Problema 2): el servicio persiste el `public_id`
# (`perfil_{persona_id}`), NUNCA la URL que devuelve el SDK, y la respuesta
# HTTP lleva una URL de entrega FIRMADA (mismo patrón que el voucher de
# pago). La firma es local (sin red), con las credenciales falsas del
# autouse `_cloudinary_credenciales_de_prueba` de conftest.py.
_FAKE_FOTO_URL_JPG = "https://res.cloudinary.com/test/image/upload/perfil-fake.jpg"
_FAKE_FOTO_URL_PNG = "https://res.cloudinary.com/test/image/upload/perfil-fake.png"
_FAKE_VERSION_JPG = 1700000001  # issue #662: subir_foto_perfil devuelve `version`, no URL
_FAKE_VERSION_PNG = 1700000002


def _assert_url_firmada_de_perfil(url: str, persona_id: int, version: int | None = None) -> None:
    from app.soporte_transversal.configuracion import settings

    assert url is not None
    assert "/authenticated/" in url
    assert f"{settings.cloudinary_carpeta_fotos_perfil}/perfil_{persona_id}" in url
    if version is not None:
        assert f"/v{version}/" in url


@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    return_value=_FAKE_VERSION_JPG,
)
def test_subir_foto_perfil_jpg_persiste_public_id_y_firma_en_get(_mock_cloudinary, client, db_session):
    persona = _crear_persona(db_session, cedula=cedula_valida(167), nombres="Paola", telefono="0991112223")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="paola@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="paola@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100  # JPEG-ish
    resp = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )
    assert resp.status_code == 200, resp.text
    _assert_url_firmada_de_perfil(resp.json()["fotoUrl"], persona.id, version=_FAKE_VERSION_JPG)

    # La fila persiste `public_id|version`, no la URL del SDK ni la firmada.
    db_session.refresh(persona)
    assert persona.foto_url == f"perfil_{persona.id}|{_FAKE_VERSION_JPG}"

    resp_get = client.get("/api/v1/auth/me")
    assert resp_get.status_code == 200, resp_get.text
    _assert_url_firmada_de_perfil(resp_get.json()["fotoUrl"], persona.id, version=_FAKE_VERSION_JPG)


@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    return_value=_FAKE_VERSION_PNG,
)
def test_subir_foto_perfil_png_actualiza_foto_url(_mock_cloudinary, client, db_session):
    persona = _crear_persona(db_session, cedula=cedula_valida(168), nombres="Renata", telefono="0991112224")
    rol_entrenador = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")
    _crear_usuario_para_persona(db_session, persona, correo="renata@cataclub.com", roles=[rol_entrenador])
    _restaurar_override_token(correo="renata@cataclub.com", persona_id=persona.id, roles=["ENTRENADOR"])

    contenido = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100  # PNG-ish
    resp = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.png", contenido, "image/png")},
    )
    assert resp.status_code == 200, resp.text
    _assert_url_firmada_de_perfil(resp.json()["fotoUrl"], persona.id, version=_FAKE_VERSION_PNG)
    db_session.refresh(persona)
    assert persona.foto_url == f"perfil_{persona.id}|{_FAKE_VERSION_PNG}"


def test_auth_me_foto_heredada_url_publica_se_devuelve_sin_tocar(client, db_session):
    """Compatibilidad durante la transición (issue #553): una foto subida
    ANTES del fix persiste la `secure_url` pública completa. Se devuelve tal
    cual (sin firmar) hasta que el operador corra
    `scripts/migrar_fotos_perfil_autenticadas.py`."""
    persona = _crear_persona(db_session, cedula=cedula_valida(173), nombres="Hilda", telefono="0991112229")
    persona.foto_url = _FAKE_FOTO_URL_JPG
    db_session.commit()
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="hilda@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="hilda@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    assert resp.json()["fotoUrl"] == _FAKE_FOTO_URL_JPG


# --- Issue #662: reemplazar una foto existente debe cambiar la URL --------
# El `public_id` es determinístico (`perfil_{persona_id}`) y el upload usa
# `overwrite=True` -- sin ALGO que cambie entre subidas, la URL de entrega
# firmada es byte-idéntica antes y después del reemplazo, y el navegador
# sigue sirviendo la imagen cacheada de la carga anterior aunque Cloudinary
# ya tenga el archivo nuevo. Este test reemplaza la foto dos veces y exige
# que la URL de entrega de la segunda subida sea DISTINTA de la primera.
@patch(
    "app.infraestructura.cloudinary_cliente.subir_foto_perfil",
    side_effect=[1700000001, 1700000002],
)
def test_reemplazar_foto_perfil_produce_una_url_distinta_a_la_anterior(_mock_cloudinary, client, db_session):
    persona = _crear_persona(db_session, cedula=cedula_valida(174), nombres="Marisol", telefono="0991112230")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(db_session, persona, correo="marisol@cataclub.com", roles=[rol_admin])
    _restaurar_override_token(correo="marisol@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    contenido_1 = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100  # JPEG-ish, foto original
    resp_1 = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto1.jpg", contenido_1, "image/jpeg")},
    )
    assert resp_1.status_code == 200, resp_1.text
    url_foto_original = resp_1.json()["fotoUrl"]
    _assert_url_firmada_de_perfil(url_foto_original, persona.id)

    contenido_2 = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x11" * 100  # JPEG-ish, reemplazo
    resp_2 = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto2.jpg", contenido_2, "image/jpeg")},
    )
    assert resp_2.status_code == 200, resp_2.text
    url_foto_reemplazada = resp_2.json()["fotoUrl"]
    _assert_url_firmada_de_perfil(url_foto_reemplazada, persona.id)

    assert url_foto_reemplazada != url_foto_original, (
        "reemplazar la foto de perfil debe producir una URL de entrega "
        "distinta a la anterior -- si no, el navegador sigue sirviendo la "
        "imagen cacheada de la carga previa (issue #662)"
    )

    # También debe persistir tras un `GET /auth/me` posterior (hard refresh).
    resp_get = client.get("/api/v1/auth/me")
    assert resp_get.status_code == 200, resp_get.text
    assert resp_get.json()["fotoUrl"] == url_foto_reemplazada


def test_subir_foto_perfil_tipo_no_permitido_da_400(client, db_session):
    persona = _crear_persona(db_session, cedula=cedula_valida(169), nombres="Bruno", telefono="0991112225")
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
    persona = _crear_persona(db_session, cedula=cedula_valida(170), nombres="Elena", telefono="0991112228")
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
    persona = _crear_persona(db_session, cedula=cedula_valida(171), nombres="Camila", telefono="0991112226")
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
    persona = _crear_persona(db_session, cedula=cedula_valida(172), nombres="Diana", telefono="0991112227")
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
