"""
Revocación unificada de sesiones (issue #4).

Criterio unificado del audit: TODA operación que retira acceso debe bombear
`Usuario.version_sesion` (vía `Usuario.revocar_sesiones`), y la validación de
tokens debe rechazar además, de forma explícita, a los usuarios inactivos
(`GestorAutenticacion.sesion_vigente`). Hoy cuatro operaciones retiran acceso
sin invalidar las sesiones activas:

  1. Restablecer contraseña (un token robado no debe sobrevivir al reset).
  2. Desactivar la cuenta (`PATCH /personas/{id}/cuenta/estado`).
  3. Baja lógica de la persona (`PATCH /personas/{id}/estado`).
  4. Quitar un rol (el access token lleva los roles embebidos: un token viejo
     conserva el rol quitado hasta su expiración natural).

Mismo patrón que test_sesiones_invalidar.py: tokens REALES contra
`client_sin_token`, para que `decodificar_token` y `/auth/refresh` ejerciten
la regla de vigencia de verdad (sin overrides).
"""
from datetime import date

import pytest

from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion


@pytest.fixture()
def usuario_real(db_session):
    """Persona + Usuario reales, mismo patrón que test_sesiones_invalidar.py."""
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula="1710034065",
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    db_session.add(Usuario(
        correo="ana@cataclub.test", contrasenia="hash", persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")],
    ))
    db_session.commit()
    return persona


@pytest.fixture()
def admin_real(db_session):
    """Administrador real y ACTIVO: autentica las operaciones admin con un
    token de verdad (no con el override de `client`) y, de paso, satisface la
    barrera anti-bloqueo de `RolServicio` cuando la víctima no es admin."""
    persona = Persona(
        nombres="Marta", apellidos="Vera", cedula="1712345678",
        fecha_nacimiento=date(1985, 6, 15), telefono="0997654321",
    )
    db_session.add(persona)
    db_session.flush()
    db_session.add(Usuario(
        correo="admin@cataclub.test", contrasenia="hash", persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")],
    ))
    db_session.commit()
    return persona


def _token_acceso(usuario: Usuario, roles: list[str] | None = None) -> str:
    return GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario.persona_id,
         "roles": roles if roles is not None else ["ALUMNO"]},
        version_sesion=usuario.version_sesion,
    )


def _token_refresco(usuario: Usuario) -> str:
    return GestorAutenticacion.crear_token_refresco(
        {"sub": usuario.correo, "persona_id": usuario.persona_id},
        version_sesion=usuario.version_sesion,
    )


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- 1. Restablecer contraseña ----------------------------------------------
def test_restablecer_contrasenia_invalida_tokens_previos(
    client_sin_token, usuario_real, db_session
):
    """Un access token robado (y su refresh hermano) no deben sobrevivir a un
    restablecimiento de contraseña: es exactamente el momento en el que el
    dueño de la cuenta intenta expulsar a un atacante."""
    usuario = usuario_real.usuario
    access_previo = _token_acceso(usuario)
    refresh_previo = _token_refresco(usuario)
    version_previa = usuario.version_sesion

    token_recuperacion = GestorAutenticacion.crear_token_recuperacion(
        usuario.correo, usuario.version_contrasenia
    )
    respuesta = client_sin_token.post(
        "/api/v1/auth/restablecer-contrasenia",
        json={"token": token_recuperacion, "nueva_contrasenia": "otraclave123"},
    )
    assert respuesta.status_code == 204

    db_session.refresh(usuario)
    assert usuario.version_sesion == version_previa + 1

    respuesta_me = client_sin_token.get("/api/v1/auth/me", headers=_bearer(access_previo))
    assert respuesta_me.status_code == 401

    respuesta_refresh = client_sin_token.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh_previo}
    )
    assert respuesta_refresh.status_code == 401


# --- 2. Desactivar la cuenta (PATCH /personas/{id}/cuenta/estado) -----------
def test_desactivar_cuenta_invalida_access_token_previo(
    client_sin_token, usuario_real, admin_real, db_session
):
    usuario = usuario_real.usuario
    access_previo = _token_acceso(usuario)
    token_admin = _token_acceso(admin_real.usuario, roles=["ADMINISTRADOR"])

    respuesta = client_sin_token.patch(
        f"/api/v1/personas/{usuario_real.id}/cuenta/estado",
        json={"activo": False},
        headers=_bearer(token_admin),
    )
    assert respuesta.status_code == 200

    respuesta_me = client_sin_token.get("/api/v1/auth/me", headers=_bearer(access_previo))
    assert respuesta_me.status_code == 401


def test_reactivar_cuenta_no_bombea_el_epoch(
    client_sin_token, usuario_real, admin_real, db_session
):
    """Reactivar NO es retirar acceso: no debe incrementar `version_sesion`.
    El criterio unificado bombea solo en las operaciones que RETIRAN acceso."""
    usuario = usuario_real.usuario
    token_admin = _token_acceso(admin_real.usuario, roles=["ADMINISTRADOR"])

    respuesta = client_sin_token.patch(
        f"/api/v1/personas/{usuario_real.id}/cuenta/estado",
        json={"activo": False},
        headers=_bearer(token_admin),
    )
    assert respuesta.status_code == 200
    db_session.refresh(usuario)
    version_tras_desactivar = usuario.version_sesion

    respuesta = client_sin_token.patch(
        f"/api/v1/personas/{usuario_real.id}/cuenta/estado",
        json={"activo": True},
        headers=_bearer(token_admin),
    )
    assert respuesta.status_code == 200
    db_session.refresh(usuario)
    assert usuario.version_sesion == version_tras_desactivar


def test_reactivar_cuenta_no_resucita_tokens_previos_a_la_desactivacion(
    client_sin_token, usuario_real, admin_real, db_session
):
    """Un token emitido ANTES de la desactivación queda muerto para siempre:
    reactivar la cuenta devuelve el acceso (vía un login nuevo), no las
    sesiones viejas."""
    usuario = usuario_real.usuario
    access_previo = _token_acceso(usuario)
    token_admin = _token_acceso(admin_real.usuario, roles=["ADMINISTRADOR"])

    for activo in (False, True):
        respuesta = client_sin_token.patch(
            f"/api/v1/personas/{usuario_real.id}/cuenta/estado",
            json={"activo": activo},
            headers=_bearer(token_admin),
        )
        assert respuesta.status_code == 200

    respuesta_me = client_sin_token.get("/api/v1/auth/me", headers=_bearer(access_previo))
    assert respuesta_me.status_code == 401


# --- 3. Baja lógica de la persona (PATCH /personas/{id}/estado) --------------
def test_baja_logica_de_persona_invalida_access_token_previo(
    client_sin_token, usuario_real, admin_real, db_session
):
    usuario = usuario_real.usuario
    access_previo = _token_acceso(usuario)
    token_admin = _token_acceso(admin_real.usuario, roles=["ADMINISTRADOR"])

    respuesta = client_sin_token.patch(
        f"/api/v1/personas/{usuario_real.id}/estado",
        json={"activo": False},
        headers=_bearer(token_admin),
    )
    assert respuesta.status_code == 200

    respuesta_me = client_sin_token.get("/api/v1/auth/me", headers=_bearer(access_previo))
    assert respuesta_me.status_code == 401


# --- 4. Quitar un rol (DELETE /personas/{id}/roles/{tipo_rol}) ---------------
def test_quitar_rol_invalida_access_token_previo(
    client_sin_token, usuario_real, admin_real, db_session
):
    """El access token lleva los roles embebidos: sin el bump, un token viejo
    conserva el rol quitado hasta su expiración natural. El usuario sigue
    ACTIVO, así que este 401 solo puede venir del mismatch de `sver` -- es la
    prueba directa del epoch bump, no del chequeo de `activo`."""
    usuario = usuario_real.usuario
    access_previo = _token_acceso(usuario)
    version_previa = usuario.version_sesion
    token_admin = _token_acceso(admin_real.usuario, roles=["ADMINISTRADOR"])

    respuesta = client_sin_token.delete(
        f"/api/v1/personas/{usuario_real.id}/roles/ALUMNO",
        headers=_bearer(token_admin),
    )
    assert respuesta.status_code == 200

    db_session.refresh(usuario)
    assert usuario.activo is True
    assert usuario.version_sesion == version_previa + 1

    respuesta_me = client_sin_token.get("/api/v1/auth/me", headers=_bearer(access_previo))
    assert respuesta_me.status_code == 401


# --- Rechazo explícito del usuario inactivo (sesion_vigente) -----------------
def test_usuario_inactivo_es_rechazado_aunque_el_sver_coincida(
    client_sin_token, usuario_real, db_session
):
    """Prueba el chequeo explícito de `activo`, no el epoch: el token se emite
    DESPUÉS de desactivar al usuario, así que su `sver` coincide con el
    `version_sesion` vigente. Si esto pasa, es porque la regla de vigencia
    valida el estado de la cuenta además del epoch -- en AMBAS rutas."""
    usuario = usuario_real.usuario
    usuario.activo = False
    db_session.commit()
    db_session.refresh(usuario)

    access_con_sver_vigente = _token_acceso(usuario)
    refresh_con_sver_vigente = _token_refresco(usuario)

    respuesta_me = client_sin_token.get(
        "/api/v1/auth/me", headers=_bearer(access_con_sver_vigente)
    )
    assert respuesta_me.status_code == 401

    respuesta_refresh = client_sin_token.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh_con_sver_vigente}
    )
    assert respuesta_refresh.status_code == 401
