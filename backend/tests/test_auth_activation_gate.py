"""Cauce de autoservicio de seguridad bajo el gate de activación (#858).

El gate de activación (ver test_auth_activation.py) bloquea los módulos del
club para cuentas públicas incompletas, PERO las superficies de seguridad
propio-via-`sub` -- logout, listar las propias sesiones, invalidar las otras
-- deben seguir alcanzables: son el botón con el que un usuario pendiente
protege su propia cuenta, y su identidad sale del `sub` del JWT, nunca de un
path param, así que dejarlas pasar no le abre dato de nadie más. El guardia
estructural (test_guardia_autorizacion_rutas.py) ya clasifica ambas rutas de
sesión en el balde "solo autenticadas, ownership via `sub`"; este archivo
fija el COMPORTAMIENTO: el gate no las convierte en 403.
"""
from datetime import date
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoModalidad, TipoRol
from app.dominio.modelos import Persona, Rol, TipoMembresia, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion


@pytest.fixture()
def alumno_incompleto(db_session):
    """ALUMNO recién autoinscripto: correo sin verificar y sin membresía
    activa -- exactamente el perfil que el gate de #858 deja del otro lado."""
    persona = Persona(
        nombres="Beto", apellidos="Cadena", cedula=cedula_valida(1234567),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    plan = TipoMembresia(categoria="Mensual", precio=Decimal("25.00"), modalidad=TipoModalidad.MENSUAL)
    db_session.add_all([persona, plan])
    db_session.flush()
    usuario = Usuario(
        correo="pendiente-sesiones@cataclub.test", contrasenia="hash",
        persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")],
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _token(usuario):
    return GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": ["ALUMNO"]},
        version_sesion=usuario.version_sesion,
    )


def test_listar_sesiones_alcanzable_para_cuenta_incompleta(client_sin_token, alumno_incompleto):
    """GET /auth/me/sesiones es propio-via-`sub` igual que /auth/me: el gate
    no debe convertirlo en 403 para quien aún no completó la activación."""
    respuesta = client_sin_token.get(
        "/api/v1/auth/me/sesiones",
        headers={"Authorization": f"Bearer {_token(alumno_incompleto)}"},
    )
    assert respuesta.status_code == 200
    assert respuesta.json() == []


def test_invalidar_otras_sesiones_alcanzable_para_cuenta_incompleta(
    client_sin_token, alumno_incompleto, db_session
):
    """POST /auth/sesiones/invalidar es el botón "cerrar mis otras sesiones":
    para un pendiente es aún más relevante (cuenta recién creada, quizás
    comprometida) y opera solo sobre SU epoch, así que debe funcionar."""
    version_previa = alumno_incompleto.version_sesion
    respuesta = client_sin_token.post(
        "/api/v1/auth/sesiones/invalidar",
        headers={"Authorization": f"Bearer {_token(alumno_incompleto)}"},
    )
    assert respuesta.status_code == 200

    db_session.refresh(alumno_incompleto)
    assert alumno_incompleto.version_sesion == version_previa + 1


def test_el_gate_sigue_bloqueando_modulos_del_club_para_cuenta_incompleta(
    client_sin_token, alumno_incompleto
):
    """Triangulación: el cauce de seguridad NO abre los módulos del club --
    un módulo del mismo perfil sigue en 403 para la misma cuenta."""
    respuesta = client_sin_token.get(
        "/api/v1/membresias/mias",
        headers={"Authorization": f"Bearer {_token(alumno_incompleto)}"},
    )
    assert respuesta.status_code == 403
