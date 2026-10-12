"""
Step-up de contraseña para el cambio de roles (#1653, S5).

`POST /personas/{id}/roles` y `DELETE /personas/{id}/roles/{tipo_rol}` exigen
que el administrador haya re-ingresado su contraseña (`POST
/auth/reautenticar`) hace MENOS de 10 minutos, en SU sesión (`sid`):

  1. sin step-up -> 403 con `codigo=reautenticacion_requerida` y los roles
     no cambian;
  2. con step-up reciente funciona; a los 10 minutos o más se rechaza;
  3. el step-up del equipo A no autoriza al equipo B del mismo admin;
  4. contraseña incorrecta -> 401, sin step-up, y suma al freno de login;
  5. un no-admin no gana permisos de roles por reautenticar;
  6. el resto de los endpoints de admin no lo piden.

Tokens REALES contra `client_sin_token` (sin overrides), con el reloj del step-up
controlado por `monkeypatch`, nunca con `sleep`.
"""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Sesion, Usuario
from app.seguridad import reautenticacion
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio import auth_servicio
from app.servicios_negocio.auth_servicio import AuthServicio

CLAVE_ADMIN = "claveAdmin123"
CODIGO = "reautenticacion_requerida"
ROLES_URL = "/api/v1/personas/{id}/roles"


@pytest.fixture(autouse=True)
def _contadores_de_login_limpios():
    auth_servicio._INTENTOS_FALLIDOS_LOGIN.clear()
    yield
    auth_servicio._INTENTOS_FALLIDOS_LOGIN.clear()


def _persona(db_session, seed: int) -> Persona:
    persona = Persona(
        nombres="Marta", apellidos="Vera", cedula=cedula_valida(seed),
        fecha_nacimiento=date(1985, 6, 15), telefono="0997654321",
    )
    db_session.add(persona)
    db_session.flush()
    return persona


@pytest.fixture()
def admin(db_session) -> Usuario:
    persona = _persona(db_session, 700)
    usuario = Usuario(
        correo="admin@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(CLAVE_ADMIN),
        persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")],
    )
    db_session.add(usuario)
    db_session.commit()
    return usuario


@pytest.fixture()
def objetivo(db_session) -> Persona:
    """Cuenta sin roles a la que el admin asigna y quita roles."""
    persona = _persona(db_session, 701)
    db_session.add(Usuario(
        correo="objetivo@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("claveObjetivo1"),
        persona_id=persona.id,
    ))
    db_session.commit()
    return persona


def _login(db_session, correo: str, clave: str, agente: str) -> dict:
    """Un equipo: login real con su propio user-agent -> su propio `sid`."""
    return AuthServicio(db_session).login(correo, clave, user_agent=agente)


def _bearer(par: dict) -> dict:
    return {"Authorization": f"Bearer {par['access_token']}"}


def _reautenticar(client, par: dict, clave: str = CLAVE_ADMIN):
    return client.post(
        "/api/v1/auth/reautenticar", json={"contrasenia": clave}, headers=_bearer(par)
    )


def _roles(db_session, persona_id: int) -> list[str]:
    db_session.expire_all()
    usuario = db_session.query(Usuario).filter(Usuario.persona_id == persona_id).one()
    return sorted(r.tipo_rol.value for r in usuario.roles)


def _asignar(client, par: dict, persona_id: int, rol: str = "ENTRENADOR"):
    return client.post(ROLES_URL.format(id=persona_id), json={"tipo_rol": rol}, headers=_bearer(par))


def _quitar(client, par: dict, persona_id: int, rol: str = "ENTRENADOR"):
    return client.delete(f"{ROLES_URL.format(id=persona_id)}/{rol}", headers=_bearer(par))


@pytest.fixture()
def reloj(monkeypatch):
    """Reloj del step-up: `reloj.avanzar(minutos=...)` mueve el tiempo."""

    class Reloj:
        def __init__(self):
            self.ahora = datetime.now(timezone.utc)

        def avanzar(self, **kwargs):
            self.ahora += timedelta(**kwargs)

    falso = Reloj()
    monkeypatch.setattr(reautenticacion, "ahora_utc", lambda: falso.ahora)
    return falso


# --- 1. sin step-up -> 403 con código, nada cambia ---------------------------
def test_asignar_rol_sin_stepup_es_403_con_codigo_y_no_cambia_nada(
    client_sin_token, admin, objetivo, db_session
):
    par = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")

    resp = _asignar(client_sin_token, par, objetivo.id)

    assert resp.status_code == 403
    assert resp.json()["codigo"] == CODIGO
    assert _roles(db_session, objetivo.id) == []


def test_quitar_rol_sin_stepup_es_403_con_codigo_y_no_cambia_nada(
    client_sin_token, admin, objetivo, db_session
):
    par = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")
    assert _reautenticar(client_sin_token, par).status_code == 200
    assert _asignar(client_sin_token, par, objetivo.id).status_code == 201
    # Otra sesión del mismo admin, sin step-up propio.
    otro = _login(db_session, admin.correo, CLAVE_ADMIN, "Chrome/129")

    resp = _quitar(client_sin_token, otro, objetivo.id)

    assert resp.status_code == 403
    assert resp.json()["codigo"] == CODIGO
    assert _roles(db_session, objetivo.id) == ["ENTRENADOR"]


# --- 2. ventana de 10 minutos ------------------------------------------------
def test_con_stepup_reciente_asignar_y_quitar_funcionan(
    client_sin_token, admin, objetivo, db_session, reloj
):
    par = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")
    assert _reautenticar(client_sin_token, par).status_code == 200

    reloj.avanzar(minutes=9, seconds=59)
    resp = _asignar(client_sin_token, par, objetivo.id)
    assert resp.status_code == 201
    assert resp.json()["roles"] == ["ENTRENADOR"]

    resp = _quitar(client_sin_token, par, objetivo.id)
    assert resp.status_code == 200
    assert _roles(db_session, objetivo.id) == []


def test_a_los_10_minutos_el_stepup_vence(client_sin_token, admin, objetivo, db_session, reloj):
    par = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")
    assert _reautenticar(client_sin_token, par).status_code == 200

    reloj.avanzar(minutes=10)
    resp = _asignar(client_sin_token, par, objetivo.id)

    assert resp.status_code == 403
    assert resp.json()["codigo"] == CODIGO
    assert _roles(db_session, objetivo.id) == []

    # Re-ingresar la contraseña abre otra ventana.
    assert _reautenticar(client_sin_token, par).status_code == 200
    assert _asignar(client_sin_token, par, objetivo.id).status_code == 201


# --- 3. el step-up es por sesión ---------------------------------------------
def test_stepup_del_equipo_a_no_autoriza_al_equipo_b(
    client_sin_token, admin, objetivo, db_session
):
    equipo_a = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")
    equipo_b = _login(db_session, admin.correo, CLAVE_ADMIN, "Chrome/129")
    assert _reautenticar(client_sin_token, equipo_a).status_code == 200

    resp_b = _asignar(client_sin_token, equipo_b, objetivo.id)

    assert resp_b.status_code == 403
    assert resp_b.json()["codigo"] == CODIGO
    assert _roles(db_session, objetivo.id) == []
    assert _asignar(client_sin_token, equipo_a, objetivo.id).status_code == 201


# --- 4. contraseña incorrecta ------------------------------------------------
def test_contrasenia_incorrecta_es_401_y_no_concede_stepup(
    client_sin_token, admin, objetivo, db_session
):
    par = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")

    resp = _reautenticar(client_sin_token, par, clave="incorrecta999")

    assert resp.status_code == 401
    assert resp.json()["codigo"] == "contrasenia_incorrecta"
    assert _asignar(client_sin_token, par, objetivo.id).status_code == 403
    assert _roles(db_session, objetivo.id) == []
    sesion = db_session.query(Sesion).filter(Sesion.usuario_id == admin.id).one()
    assert sesion.reautenticada_en is None


def test_contrasenia_incorrecta_suma_al_freno_de_login_y_enfria_la_cuenta(
    client_sin_token, admin, db_session, monkeypatch
):
    par = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")
    # Sin sleep real: el retraso progresivo no es lo que se prueba acá.
    monkeypatch.setattr(auth_servicio, "_calcular_retraso_login", lambda intentos: 0)

    for _ in range(auth_servicio._UMBRAL_ENFRIAMIENTO_INTENTOS):
        assert _reautenticar(client_sin_token, par, clave="incorrecta999").status_code == 401
    # Cuenta enfriada: ni la contraseña correcta pasa, igual que en login.
    resp = _reautenticar(client_sin_token, par)

    assert resp.status_code == 429
    assert "Retry-After" in resp.headers
    sesion = db_session.query(Sesion).filter(Sesion.usuario_id == admin.id).one()
    assert sesion.reautenticada_en is None


def test_reautenticar_con_la_contrasenia_correcta_limpia_los_fallos_previos(
    client_sin_token, admin, db_session
):
    par = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")
    clave = admin.correo.strip().lower()
    auth_servicio._INTENTOS_FALLIDOS_LOGIN[clave] = (2, 0.0, None)

    assert _reautenticar(client_sin_token, par).status_code == 200

    assert clave not in auth_servicio._INTENTOS_FALLIDOS_LOGIN


def test_reautenticar_exige_autenticacion(client_sin_token):
    resp = client_sin_token.post("/api/v1/auth/reautenticar", json={"contrasenia": "x"})
    assert resp.status_code == 401


# --- 5. un no-admin no gana derechos de roles --------------------------------
def test_un_no_admin_que_reautentica_sigue_sin_poder_cambiar_roles(
    client_sin_token, objetivo, db_session
):
    persona = _persona(db_session, 702)
    db_session.add(Usuario(
        correo="entrenador@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("claveEntrenador1"),
        persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")],
    ))
    db_session.commit()
    par = _login(db_session, "entrenador@cataclub.test", "claveEntrenador1", "Firefox/130")

    assert _reautenticar(client_sin_token, par, clave="claveEntrenador1").status_code == 200
    resp = _asignar(client_sin_token, par, objetivo.id, rol="ADMINISTRADOR")

    assert resp.status_code == 403
    assert resp.json().get("codigo") != CODIGO  # es falta de permisos, no de step-up
    assert _roles(db_session, objetivo.id) == []


# --- 6. el resto de los endpoints de admin no lo piden -----------------------
def test_otros_endpoints_de_admin_no_exigen_stepup(client_sin_token, admin, objetivo, db_session):
    par = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")

    # Lectura de roles, activar/desactivar cuenta y listado: sin step-up.
    assert client_sin_token.get(
        ROLES_URL.format(id=objetivo.id), headers=_bearer(par)
    ).status_code == 200
    resp = client_sin_token.patch(
        f"/api/v1/personas/{objetivo.id}/cuenta/estado", json={"activo": False}, headers=_bearer(par)
    )
    assert resp.status_code == 200
    assert client_sin_token.get("/api/v1/personas/", headers=_bearer(par)).status_code == 200


# --- Efecto colateral: el cambio de roles sigue revocando al objetivo --------
def test_quitar_un_rol_sigue_bombeando_el_epoch_del_objetivo(
    client_sin_token, admin, objetivo, db_session
):
    par = _login(db_session, admin.correo, CLAVE_ADMIN, "Firefox/130")
    assert _reautenticar(client_sin_token, par).status_code == 200
    usuario = db_session.query(Usuario).filter(Usuario.persona_id == objetivo.id).one()
    assert _asignar(client_sin_token, par, objetivo.id).status_code == 201
    db_session.refresh(usuario)
    version_previa = usuario.version_sesion

    assert _quitar(client_sin_token, par, objetivo.id).status_code == 200

    db_session.refresh(usuario)
    assert usuario.version_sesion == version_previa + 1
