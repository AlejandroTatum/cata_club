"""
Logout por dispositivo (#1653, S4).

"Cerrar sesión" revoca SOLO la sesión actual (`sid`, vía `sesion.revocada_en`);
"Cerrar sesión en otros dispositivos" (`POST /auth/sesiones/invalidar`) y los
eventos de cuenta (restablecer contraseña, cambio de rol, desactivación) siguen
bombeando el epoch y matando TODAS las sesiones.

Tokens REALES (dos logins = dos dispositivos) contra `client_sin_token`, por la
interfaz HTTP pública. Regresión ya cubierta, no se repite aquí:
  - cambio de contraseña: test_cambio_contrasenia.py::
    test_exito_cambia_la_clave_y_revoca_otras_sesiones_manteniendo_la_actual
  - las revocaciones por epoch con tokens sin `sid`: test_revocacion_unificada_sesiones.py
"""
from datetime import date, datetime, timezone

import jwt
import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Sesion, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.soporte_transversal.configuracion import settings

CORREO = "ana@cataclub.test"
CLAVE = "clave12345"


@pytest.fixture()
def usuario(db_session) -> Usuario:
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula="1710034065",
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo=CORREO,
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(CLAVE),
        persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")],
    )
    db_session.add(usuario)
    db_session.commit()
    return usuario


@pytest.fixture()
def admin(db_session) -> Usuario:
    persona = Persona(
        nombres="Marta", apellidos="Vera", cedula=cedula_valida(580),
        fecha_nacimiento=date(1985, 6, 15), telefono="0997654321",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo="admin@cataclub.test", contrasenia="hash", persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")],
    )
    db_session.add(usuario)
    db_session.commit()
    return usuario


def _login(db_session, agente: str) -> dict:
    return AuthServicio(db_session).login(CORREO, CLAVE, user_agent=agente)


@pytest.fixture()
def dos_dispositivos(db_session, usuario) -> tuple[dict, dict]:
    """Dos logins independientes bajo el mismo epoch: A (laptop) y B (celular)."""
    return _login(db_session, "curl/8.7.1"), _login(db_session, "Mozilla/5.0 (iPhone) Safari/604.1")


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _me(client, token: str):
    return client.get("/api/v1/auth/me", headers=_bearer(token))


def _refrescar(client, refresh_token: str):
    return client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})


def _logout(client, token: str):
    return client.post("/api/v1/auth/logout", headers=_bearer(token))


def _assert_ambos_muertos(client, a: dict, b: dict) -> None:
    for par in (a, b):
        assert _me(client, par["access_token"]).status_code == 401
        assert _refrescar(client, par["refresh_token"]).status_code == 401


# --- (a) logout revoca solo ESTE dispositivo ---------------------------------
def test_logout_revoca_solo_la_sesion_actual(client_sin_token, dos_dispositivos):
    a, b = dos_dispositivos

    assert _logout(client_sin_token, a["access_token"]).status_code == 200

    assert _me(client_sin_token, a["access_token"]).status_code == 401
    assert _refrescar(client_sin_token, a["refresh_token"]).status_code == 401
    assert _me(client_sin_token, b["access_token"]).status_code == 200
    refresco_b = _refrescar(client_sin_token, b["refresh_token"])
    assert refresco_b.status_code == 200
    assert _me(client_sin_token, refresco_b.json()["access_token"]).status_code == 200


def test_logout_marca_revocada_en_y_no_bombea_el_epoch(client_sin_token, dos_dispositivos, usuario, db_session):
    a, b = dos_dispositivos
    version_previa = usuario.version_sesion

    assert _logout(client_sin_token, a["access_token"]).status_code == 200

    db_session.expire_all()
    assert usuario.version_sesion == version_previa
    filas = db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).order_by(Sesion.id).all()
    assert [f.revocada_en is not None for f in filas] == [True, False]
    vistas = AuthServicio(db_session).listar_sesiones(usuario.correo, sesion_actual_id=None)
    assert sorted(v.vigente for v in vistas) == [False, True]


# --- (b) "otros dispositivos" sigue revocando todas las demás ----------------
def test_invalidar_otras_sesiones_mata_las_demas_y_el_caller_sigue_con_el_par_nuevo(
    client_sin_token, dos_dispositivos
):
    a, b = dos_dispositivos

    respuesta = client_sin_token.post("/api/v1/auth/sesiones/invalidar", headers=_bearer(a["access_token"]))
    assert respuesta.status_code == 200
    nuevo = respuesta.json()

    _assert_ambos_muertos(client_sin_token, a, b)
    assert _me(client_sin_token, nuevo["access_token"]).status_code == 200
    assert _refrescar(client_sin_token, nuevo["refresh_token"]).status_code == 200


# --- (c) eventos de cuenta siguen revocando TODAS las sesiones ---------------
def test_restablecer_contrasenia_mata_todas_las_sesiones(client_sin_token, dos_dispositivos, usuario):
    a, b = dos_dispositivos
    token = GestorAutenticacion.crear_token_recuperacion(usuario.correo, usuario.version_contrasenia)

    respuesta = client_sin_token.post(
        "/api/v1/auth/restablecer-contrasenia", json={"token": token, "nueva_contrasenia": "otraclave123"},
    )
    assert respuesta.status_code == 204

    _assert_ambos_muertos(client_sin_token, a, b)


def test_quitar_rol_mata_todas_las_sesiones(client_sin_token, dos_dispositivos, usuario, admin):
    a, b = dos_dispositivos
    token_admin = GestorAutenticacion.crear_token_acceso(
        {"sub": admin.correo, "persona_id": admin.persona_id, "roles": ["ADMINISTRADOR"]},
        version_sesion=admin.version_sesion,
    )

    respuesta = client_sin_token.delete(
        f"/api/v1/personas/{usuario.persona_id}/roles/ALUMNO", headers=_bearer(token_admin),
    )
    assert respuesta.status_code == 200

    _assert_ambos_muertos(client_sin_token, a, b)


def test_desactivar_cuenta_mata_todas_las_sesiones(client_sin_token, dos_dispositivos, usuario, admin):
    a, b = dos_dispositivos
    token_admin = GestorAutenticacion.crear_token_acceso(
        {"sub": admin.correo, "persona_id": admin.persona_id, "roles": ["ADMINISTRADOR"]},
        version_sesion=admin.version_sesion,
    )

    respuesta = client_sin_token.patch(
        f"/api/v1/personas/{usuario.persona_id}/cuenta/estado",
        json={"activo": False}, headers=_bearer(token_admin),
    )
    assert respuesta.status_code == 200

    _assert_ambos_muertos(client_sin_token, a, b)


# --- (d) idempotencia ---------------------------------------------------------
def test_logout_repetido_es_401_nunca_500_y_no_toca_a_las_demas(client_sin_token, dos_dispositivos):
    """El segundo logout con el mismo access ya no autentica (su sesión murió):
    401, el mismo rechazo de cualquier token muerto. El BFF ignora el resultado
    y borra las cookies igual. La otra sesión sigue intacta."""
    a, b = dos_dispositivos

    assert _logout(client_sin_token, a["access_token"]).status_code == 200
    assert _logout(client_sin_token, a["access_token"]).status_code == 401

    assert _me(client_sin_token, b["access_token"]).status_code == 200


def test_logout_con_sid_ya_revocada_es_401(client_sin_token, dos_dispositivos, db_session):
    a, _ = dos_dispositivos
    sid = jwt.decode(a["access_token"], settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])["sid"]
    db_session.get(Sesion, sid).revocada_en = datetime.now(timezone.utc)
    db_session.commit()

    assert _logout(client_sin_token, a["access_token"]).status_code == 401


def test_cerrar_sesion_con_sid_ya_revocada_o_inexistente_es_noop_ok(db_session, usuario, dos_dispositivos):
    """Si la fila se revocó entre la autenticación y el servicio (carrera), el
    servicio responde igual que siempre, conserva la marca original y NO bombea
    el epoch. Una `sid` inexistente tampoco falla."""
    servicio = AuthServicio(db_session)
    version_previa = usuario.version_sesion
    fila = db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).order_by(Sesion.id).first()

    assert servicio.cerrar_sesion(usuario.correo, fila.id) == {"mensaje": "Sesión finalizada"}
    marca = fila.revocada_en
    assert marca is not None
    assert servicio.cerrar_sesion(usuario.correo, fila.id) == {"mensaje": "Sesión finalizada"}
    assert servicio.cerrar_sesion(usuario.correo, 987654) == {"mensaje": "Sesión finalizada"}

    db_session.expire_all()
    assert fila.revocada_en == marca
    assert usuario.version_sesion == version_previa


def test_logout_con_access_legacy_sin_sid_responde_200_y_cae_al_epoch(client_sin_token, dos_dispositivos, usuario):
    """Un access emitido antes de la rotación no dice de qué dispositivo es:
    no se puede revocar 'solo este', así que se conserva el comportamiento
    anterior (bump del epoch, mueren todas). Jamás un 500."""
    a, b = dos_dispositivos
    legacy = GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": ["ALUMNO"]},
        version_sesion=usuario.version_sesion,
    )

    assert _logout(client_sin_token, legacy).status_code == 200

    assert _me(client_sin_token, legacy).status_code == 401
    _assert_ambos_muertos(client_sin_token, a, b)
