"""
Candados de atomicidad para casos de uso multi-repositorio (issue #831).

Antes, cada `Repositorio.crear`/`guardar_cambios` comiteaba por su cuenta:
un caso de uso que escribe a través de varios repositorios producía varias
transacciones -- si la última escritura fallaba, las anteriores ya estaban
comiteadas. Los primeros dos candados fijan, con `pytest.raises` + monkeypatch
de la ÚLTIMA escritura, que eso ya no puede pasar: la excepción deja SIN NADA
persistido. Ambos fallan sobre `main` (antes de este issue) -- ver el reporte
del PR para la salida roja real.

El tercero (`validar_pago`) es distinto a propósito: `_crear_notificacion`
YA atrapaba cualquier error del aviso in-app y nunca relanzaba (diseño
anterior a este issue, ver su docstring) -- un aviso roto NUNCA debía poder
deshacer una aprobación real, así que ESE candado pasa también sobre `main`.
Lo que fija es la frontera correcta tras mover el commit al caso de uso: la
aprobación (Pago + activación de Membresia) sigue comiteando como una sola
unidad, y el aviso roto sigue sin poder tocarla.
"""
from datetime import date, time
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import Categoria, DiaSemana, EstadoAsistencia, EstadoMembresia, EstadoPago, TipoPago
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import AlumnoHorario, Asistencia, HorarioEntrenamiento, Pago, Persona, Usuario
from app.infraestructura.repositorios.notificacion_repositorio import NotificacionRepositorio
from app.infraestructura.repositorios.usuario_ficha_repositorio import FichaMedicaRepositorio
from app.servicios_negocio.admin_cuenta_servicio import AdminCuentaServicio
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoValidarDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm


def _falla(*args, **kwargs):
    raise RuntimeError("fallo simulado en la última escritura del caso de uso")


# --- 1. AdminCuentaServicio.crear_cuenta: Persona + Usuario + Rol + Ficha --

def _payload_admin_cuenta(**overrides) -> dict:
    data = {
        "tipo_cuenta": "JUGADOR",
        "nombres": "Cata", "apellidos": "Atómica",
        "cedula": cedula_valida(831),
        "fecha_nacimiento": "1995-06-15",
        "telefono": "0991230831",
        "correo": "atomica831@test.com",
        "contrasenia": "clave12345",
        "ficha_medica": {
            "tipo_sangre": "O_POSITIVO",
            "enfermedades": [],
            "contacto_emergencia": "Contacto Emergencia",
            "telefono_emergencia": "0991230832",
        },
    }
    data.update(overrides)
    return data


def test_crear_cuenta_no_deja_persona_ni_usuario_si_la_ficha_medica_falla(db_session, monkeypatch):
    """La ficha médica es la ÚLTIMA escritura de `crear_cuenta` (Persona,
    Usuario, Rol, Ficha). Si falla, nada de lo anterior debe sobrevivir."""
    monkeypatch.setattr(FichaMedicaRepositorio, "crear", _falla)
    datos = AdminCrearCuentaDTO(**_payload_admin_cuenta())

    with pytest.raises(RuntimeError):
        AdminCuentaServicio(db_session).crear_cuenta(datos)
    db_session.rollback()

    assert db_session.query(Persona).filter(Persona.cedula == datos.cedula).first() is None
    assert db_session.query(Usuario).filter(Usuario.correo == datos.correo).first() is None


# --- 2. AsistenciaServicio.eliminar_horario: alumno_horario + horario -----

def _crear_horario_con_historial(db_session) -> tuple[HorarioEntrenamiento, Persona]:
    alumno = crear_persona_orm(db_session, cedula_valida(832))
    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES,
        hora_inicio=time(17, 0), hora_fin=time(18, 0),
    )
    db_session.add(horario)
    db_session.flush()
    db_session.add(AlumnoHorario(persona_id=alumno.id, horario_id=horario.id))
    db_session.add(Asistencia(
        fecha_entrenamiento=date(2026, 8, 24), estado=EstadoAsistencia.PRESENTE,
        persona_id=alumno.id, horario_id=horario.id,
    ))
    db_session.commit()
    return horario, alumno


def test_eliminar_horario_con_historial_no_deja_al_alumno_desasignado(db_session):
    """`eliminar_horario` primero desasigna `alumno_horario` y recién
    después intenta borrar el `horario_entrenamiento`; ese segundo paso lo
    rechaza `eliminacion_segura.py` porque el horario tiene asistencias.
    Todo o nada: el alumno debe seguir asignado."""
    horario, alumno = _crear_horario_con_historial(db_session)

    with pytest.raises(OperacionInvalida):
        AsistenciaServicio(db_session).eliminar_horario(horario.id)

    asignaciones = (
        db_session.query(AlumnoHorario)
        .filter(AlumnoHorario.horario_id == horario.id, AlumnoHorario.persona_id == alumno.id)
        .all()
    )
    assert len(asignaciones) == 1, "el borrado parcial dejó al alumno sin su asignación"
    assert db_session.get(HorarioEntrenamiento, horario.id) is not None


# --- 3. PagoServicio.validar_pago: Membresia + Pago comitean juntos -------

def _crear_pago_pendiente(db_session):
    admin = crear_persona_orm(db_session, cedula_valida(834))
    persona = crear_persona_orm(db_session, cedula_valida(833))
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    pago = Pago(
        monto=Decimal("30.00"), estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(2026, 8, 1), fecha_fin=date(2026, 8, 31),
        persona_id=persona.id, membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return admin, membresia, pago


def test_validar_pago_aprobado_sobrevive_a_un_aviso_que_falla(db_session, monkeypatch):
    """`validar_pago` comitea la aprobación (Pago + activación de Membresia)
    ANTES de intentar la notificación in-app (issue #831): un aviso fallido
    -- `_crear_notificacion` lo atrapa y jamás relanza, ver su docstring --
    no puede tirar para atrás una aprobación que ya ocurrió. Este candado
    fija esa frontera: `NotificacionRepositorio.crear` roto no impide que
    el pago quede APROBADO y la membresía ACTIVA."""
    admin, membresia, pago = _crear_pago_pendiente(db_session)
    monkeypatch.setattr(NotificacionRepositorio, "crear", _falla)

    resultado = PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    assert resultado.estado_pago == EstadoPago.APROBADO
    assert resultado.aviso_no_enviado is True
    membresia_fresca = db_session.get(type(membresia), membresia.id)
    assert membresia_fresca.estado == EstadoMembresia.ACTIVA
