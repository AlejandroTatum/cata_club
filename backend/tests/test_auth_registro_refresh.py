"""
Tests de autenticación: registro, /me, refresh y logout.

Cubre:
  - Registro exitoso (solo ADMINISTRADOR): persona existente sin usuario -> 201 + tokens.
  - Registro sin token -> 401.
  - Registro con token no-admin -> 403.
  - Registro falla si la cédula no tiene Persona asociada -> 404.
  - Registro falla si la persona ya tiene usuario -> 400.
  - Registro falla si el correo ya existe para otro usuario -> 400.
  - GET /auth/me devuelve el perfil correcto con token válido.
  - POST /auth/refresh con refresh token válido -> nuevo access_token.
  - POST /auth/refresh con un access token (en vez de refresh) -> 401.
  - POST /auth/logout devuelve mensaje de sesión finalizada.
"""
from datetime import date

from app.dominio.modelos import Usuario, Rol
from app.dominio.enums import TipoRol
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA
from app.seguridad.gestor_auth import GestorAutenticacion


# --- helpers ---------------------------------------------------------------
def _crear_persona(db_session, cedula="1710034065", nombres="Ana"):
    """Crea una Persona vía ORM (sin Usuario asociado) para probar registro."""
    from app.dominio.modelos import Persona
    p = Persona(
        nombres=nombres, apellidos="Torres", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def _crear_usuario_para_persona(db_session, persona, correo=None, roles=None):
    """Crea un Usuario (con rol opcional) para una Persona existente vía ORM."""
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


def _quitar_override_token():
    """Quita el override global del token del conftest para que los endpoints
    públicos (/auth/refresh) no reciban un token falso. Para
    /auth/me se restaura manualmente el override según el test."""
    from main import app
    app.dependency_overrides.pop(GestorAutenticacion.decodificar_token, None)


def _restaurar_override_token(correo="user@cataclub.test", persona_id=1, roles=None):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": correo, "persona_id": persona_id, "roles": roles or [],
    }


def _override_admin_token():
    """Configura el override del token con rol ADMINISTRADOR para endpoints protegidos."""
    _restaurar_override_token(correo="admin@cataclub.test", persona_id=1, roles=["ADMINISTRADOR"])


# --- Registro (solo ADMINISTRADOR) -----------------------------------------
def test_registro_exitoso_persona_sin_usuario(client, db_session):
    _override_admin_token()
    _crear_persona(db_session, cedula="1710034065")

    resp = client.post(
        "/api/v1/auth/registro",
        json={
            "cedula": "1710034065",
            "correo": "nueva@cataclub.com",
            "contrasenia": "clave12345",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["token_type"] == "bearer"


def test_registro_sin_token_devuelve_401(client, db_session):
    _quitar_override_token()
    _crear_persona(db_session, cedula="1710034060")
    resp = client.post(
        "/api/v1/auth/registro",
        json={"cedula": "1710034060", "correo": "x@cataclub.com", "contrasenia": "clave12345"},
    )
    assert resp.status_code == 401


def test_registro_con_rol_no_admin_devuelve_403(client, db_session):
    _restaurar_override_token(roles=["ALUMNO"])
    _crear_persona(db_session, cedula="1710034061")
    resp = client.post(
        "/api/v1/auth/registro",
        json={"cedula": "1710034061", "correo": "x@cataclub.com", "contrasenia": "clave12345"},
    )
    assert resp.status_code == 403


def test_registro_falla_si_cedula_no_tiene_persona(client, db_session):
    _override_admin_token()
    resp = client.post(
        "/api/v1/auth/registro",
        json={"cedula": "9999999999", "correo": "x@cataclub.com", "contrasenia": "clave12345"},
    )
    assert resp.status_code == 404
    assert "cédula" in resp.json()["detail"].lower() or "administrador" in resp.json()["detail"].lower()


def test_registro_falla_si_persona_ya_tiene_usuario(client, db_session):
    _override_admin_token()
    persona = _crear_persona(db_session, cedula="1710034073")
    _crear_usuario_para_persona(db_session, persona, correo="usado@cataclub.com")

    resp = client.post(
        "/api/v1/auth/registro",
        json={"cedula": "1710034073", "correo": "otro@cataclub.com", "contrasenia": "clave12345"},
    )
    assert resp.status_code == 400
    assert "cuenta" in resp.json()["detail"].lower()


def test_registro_falla_si_correo_ya_existe(client, db_session):
    _override_admin_token()
    p1 = _crear_persona(db_session, cedula="1710034081", nombres="Carlos")
    _crear_usuario_para_persona(db_session, p1, correo="repetido@cataclub.com")

    _crear_persona(db_session, cedula="1710034099", nombres="Diego")
    resp = client.post(
        "/api/v1/auth/registro",
        json={"cedula": "1710034099", "correo": "repetido@cataclub.com", "contrasenia": "clave12345"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == MENSAJE_IDENTIDAD_DUPLICADA


# --- /auth/me ---------------------------------------------------------------
def test_auth_me_devuelve_perfil_usuario(client, db_session):
    persona = _crear_persona(db_session, cedula="1710034107", nombres="Lucía")
    rol_admin = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Admin")
    _crear_usuario_para_persona(
        db_session, persona, correo="lucia@cataclub.com", roles=[rol_admin],
    )

    _restaurar_override_token(correo="lucia@cataclub.com", persona_id=persona.id, roles=["ADMINISTRADOR"])

    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["correo"] == "lucia@cataclub.com"
    assert body["personaId"] == persona.id
    assert body["nombres"] == "Lucía"
    assert body["apellidos"] == "Torres"
    assert "ADMINISTRADOR" in body["roles"]


# --- /auth/refresh ----------------------------------------------------------
def test_refresh_token_valido_devuelve_nuevo_access(client, db_session):
    _quitar_override_token()

    persona = _crear_persona(db_session, cedula="1710034115", nombres="Mario")
    rol = Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")
    _crear_usuario_para_persona(
        db_session, persona, correo="mario@cataclub.com", roles=[rol],
    )

    # Login real (no hay mock): el endpoint /auth/login valida contraseña.
    login_resp = client.post(
        "/api/v1/auth/login",
        data={"username": "mario@cataclub.com", "password": "clave12345"},
    )
    assert login_resp.status_code == 200, login_resp.text
    refresh = login_resp.json()["refresh_token"]

    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "access_token" in body
    assert body.get("token_type") == "bearer"


def test_refresh_con_access_token_en_vez_de_refresh_da_401(client, db_session):
    _quitar_override_token()

    persona = _crear_persona(db_session, cedula="1710034123", nombres="Pedro")
    _crear_usuario_para_persona(db_session, persona, correo="pedro@cataclub.com")

    login_resp = client.post(
        "/api/v1/auth/login",
        data={"username": "pedro@cataclub.com", "password": "clave12345"},
    )
    assert login_resp.status_code == 200
    access = login_resp.json()["access_token"]  # type=access

    resp = client.post("/api/v1/auth/refresh", json={"refresh_token": access})
    assert resp.status_code == 401


# --- /auth/logout -----------------------------------------------------------
def test_logout_devuelve_mensaje(client):
    _restaurar_override_token(correo="x@cataclub.com", persona_id=1, roles=["ALUMNO"])
    resp = client.post("/api/v1/auth/logout")
    assert resp.status_code == 200
    assert "finalizada" in resp.json()["mensaje"].lower()
