"""
POST /auth/sesiones/invalidar -- "cerrar mis otras sesiones" (E01, slice B3).

El mecanismo de invalidación (epoch `version_sesion` + `sver` claim +
`epoch_valido`) ya existe y está enforced en AMBAS rutas de token desde B2
(ver test_auth_tipo_token.py). Lo que falta es el botón: un endpoint
autenticado que bombee el epoch del USUARIO QUE LLAMA y le reemita un par de
tokens nuevo en la misma respuesta, para que el caller no se desloguee a sí
mismo -- eso es lo que distingue "otras sesiones" de "todas mis sesiones".
"""
from datetime import date

import jwt
import pytest

from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.soporte_transversal.configuracion import settings


@pytest.fixture()
def usuario_real(db_session):
    """Persona + Usuario reales, mismo patrón que test_auth_tipo_token.py."""
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


def _token_acceso(usuario: Usuario) -> str:
    return GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": ["ALUMNO"]},
        version_sesion=usuario.version_sesion,
    )


def test_requiere_autenticacion(client_sin_token):
    """Sin Authorization header, el endpoint rechaza -- no hay sesión que invalidar."""
    respuesta = client_sin_token.post("/api/v1/auth/sesiones/invalidar")
    assert respuesta.status_code == 401


def test_invalidar_incrementa_version_sesion_en_exactamente_uno(client_sin_token, usuario_real, db_session):
    usuario = usuario_real.usuario
    version_previa = usuario.version_sesion
    access = _token_acceso(usuario)

    respuesta = client_sin_token.post(
        "/api/v1/auth/sesiones/invalidar", headers={"Authorization": f"Bearer {access}"}
    )
    assert respuesta.status_code == 200

    db_session.refresh(usuario)
    assert usuario.version_sesion == version_previa + 1


def test_invalidar_reemite_par_de_tokens_y_el_caller_permanece_autenticado(
    client_sin_token, usuario_real, db_session
):
    """El punto entero del re-issue: el caller usa el token DEVUELTO por este
    mismo endpoint y sigue autenticado -- no se desloguea a sí mismo."""
    usuario = usuario_real.usuario
    access_previo = _token_acceso(usuario)

    respuesta = client_sin_token.post(
        "/api/v1/auth/sesiones/invalidar", headers={"Authorization": f"Bearer {access_previo}"}
    )
    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["token_type"] == "bearer"
    assert isinstance(cuerpo["access_token"], str) and cuerpo["access_token"] != access_previo
    assert isinstance(cuerpo["refresh_token"], str)

    db_session.refresh(usuario)
    payload_nuevo = jwt.decode(
        cuerpo["access_token"], settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo]
    )
    assert payload_nuevo["sver"] == usuario.version_sesion

    respuesta_me = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {cuerpo['access_token']}"}
    )
    assert respuesta_me.status_code == 200
    assert respuesta_me.json()["correo"] == usuario.correo


def test_invalidar_deja_sin_efecto_el_token_previo_a_la_llamada(client_sin_token, usuario_real, db_session):
    """El token CON EL QUE SE LLAMÓ al endpoint queda invalidado por el
    epoch bump que el propio endpoint provoca -- esta es la garantía real
    de 'cerrar mis otras sesiones': cualquier token minted antes de esta
    llamada, incluido el que se usó para autenticarla, deja de servir."""
    usuario = usuario_real.usuario
    access_previo = _token_acceso(usuario)

    respuesta = client_sin_token.post(
        "/api/v1/auth/sesiones/invalidar", headers={"Authorization": f"Bearer {access_previo}"}
    )
    assert respuesta.status_code == 200

    respuesta_repetida = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access_previo}"}
    )
    assert respuesta_repetida.status_code == 401
