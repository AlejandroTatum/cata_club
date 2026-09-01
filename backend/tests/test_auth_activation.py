"""Pruebas del gate de activación inicial de cuentas públicas (#858)."""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, TipoModalidad, TipoRol
from app.dominio.modelos import (
    HistorialEstadoMembresia,
    Membresia,
    Persona,
    Rol,
    TipoMembresia,
    Usuario,
)
from app.seguridad.gestor_auth import GestorAutenticacion


def _crear_usuario(db_session, *, correo, correo_verificado, estado_membresia=None, rol=TipoRol.ALUMNO):
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula_valida(abs(hash(correo)) % 90000 + 100),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    plan = TipoMembresia(categoria="Mensual", precio=Decimal("25.00"), modalidad=TipoModalidad.MENSUAL)
    db_session.add_all([persona, plan])
    db_session.flush()
    usuario = Usuario(
        correo=correo,
        contrasenia="hash",
        persona_id=persona.id,
        correo_verificado=correo_verificado,
        roles=[Rol(tipo_rol=rol, descripcion=rol.value)],
    )
    db_session.add(usuario)
    if estado_membresia is not None:
        db_session.add(Membresia(
            estado=estado_membresia,
            monto_aplicado=Decimal("25.00"),
            fecha_activacion=datetime.now(timezone.utc),
            persona_id=persona.id,
            tipo_membresia_id=plan.id,
        ))
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _token(usuario):
    return GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": [r.tipo_rol.value for r in usuario.roles]},
        version_sesion=usuario.version_sesion,
    )


@pytest.mark.parametrize(
    ("correo_verificado", "estado_membresia", "debe_pasar"),
    [
        (False, None, False),
        (True, None, False),
        (False, EstadoMembresia.ACTIVA, False),
        (True, EstadoMembresia.ACTIVA, True),
        (True, EstadoMembresia.VENCIDA, True),
    ],
)
def test_gate_exige_correo_y_primera_membresia_activa(
    db_session, client_sin_token, correo_verificado, estado_membresia, debe_pasar,
):
    usuario = _crear_usuario(
        db_session,
        correo=f"estado-{correo_verificado}-{estado_membresia}@cataclub.test",
        correo_verificado=correo_verificado,
        estado_membresia=estado_membresia,
    )
    respuesta = client_sin_token.get(
        "/api/v1/membresias/mias",
        headers={"Authorization": f"Bearer {_token(usuario)}"},
    )
    assert (respuesta.status_code == 200) is debe_pasar


def test_historial_de_activacion_conserva_acceso_despues_de_cambio_de_estado(db_session):
    usuario = _crear_usuario(
        db_session, correo="historico@cataclub.test", correo_verificado=True,
        estado_membresia=EstadoMembresia.VENCIDA,
    )
    membresia = db_session.query(Membresia).filter_by(persona_id=usuario.persona_id).one()
    db_session.add(HistorialEstadoMembresia(
        membresia_id=membresia.id,
        estado_anterior=EstadoMembresia.INACTIVA,
        estado_nuevo=EstadoMembresia.ACTIVA,
        fecha_efectiva=membresia.fecha_activacion,
    ))
    db_session.commit()

    assert GestorAutenticacion.alta_presencial_completada(db_session, usuario.persona_id)


def test_auth_me_expone_los_dos_estados_para_la_experiencia_limitada(client_sin_token, db_session):
    usuario = _crear_usuario(
        db_session, correo="pendiente@cataclub.test", correo_verificado=False,
    )
    respuesta = client_sin_token.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {_token(usuario)}"},
    )
    assert respuesta.status_code == 200
    assert respuesta.json()["correoVerificado"] is False
    assert respuesta.json()["altaPresencialCompletada"] is False


def test_administracion_y_entrenadores_no_quedan_atrapados_por_el_gate(client_sin_token, db_session):
    for rol, correo in ((TipoRol.ADMINISTRADOR, "admin-gate@cataclub.test"), (TipoRol.ENTRENADOR, "trainer-gate@cataclub.test")):
        usuario = _crear_usuario(
            db_session, correo=correo, correo_verificado=False, rol=rol,
        )
        respuesta = client_sin_token.get(
            "/api/v1/membresias/mias",
            headers={"Authorization": f"Bearer {_token(usuario)}"},
        )
        assert respuesta.status_code != 403
