"""Issue #1132: "ser jugador" es una membresía ACTIVA, nunca un rol.

Contrato final (comentario del dueño en el issue):
  - La condición de jugador se deriva EXCLUSIVAMENTE de una membresía
    ACTIVA.
  - Un representante puro no aparece como jugador en Miembros.
  - Puede pagar una membresía para su misma Persona y conserva únicamente
    el rol técnico REPRESENTANTE -- no se agrega ALUMNO (issue #762 sigue
    intacto: un solo rol activo por cuenta).
  - Mientras el pago esté pendiente o rechazado, permanece fuera del
    listado deportivo y de horario/asistencia. Al aprobarse, la membresía
    pasa a ACTIVA y las tres cosas se habilitan.
  - El alumno representado sigue la misma regla.

Este archivo prueba el predicado único (`es_jugador` /
`MembresiaRepositorio.tiene_membresia_activa`), su desacople del rol, y el
gate de horario/asistencia que ahora usa `tiene_membresia_activada_alguna_
vez` (issue #1132 + decisión de negocio #4, ver el docstring de esa
consulta en `membresia_repositorio.py`)."""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import Categoria, DiaSemana, EstadoMembresia, EstadoPago, TipoPago, TipoRol
from app.dominio.excepciones import OperacionInvalida
from app.dominio.jugador import es_jugador
from app.dominio.modelos import Persona, Rol, Usuario
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from app.servicios_negocio.dtos.asistencia_schemas import AlumnoHorarioCreateDTO, HorarioCreateDTO
from app.servicios_negocio.dtos.membresia_pago_schemas import (
    MembresiaCreateDTO, PagoCreateDTO, PagoValidarDTO,
)
from app.servicios_negocio.membresia_pago_servicio import MembresiaServicio, PagoServicio
from tests.fabricas_pagos import crear_persona_orm, crear_tipo_membresia_orm


# --- fábricas ---------------------------------------------------------------

def _crear_representante_con_usuario(sesion, cedula: str) -> Persona:
    persona = crear_persona_orm(sesion, cedula, nombres="Marta", apellidos="Reyes")
    rol = sesion.query(Rol).filter(Rol.tipo_rol == TipoRol.REPRESENTANTE).first()
    if rol is None:
        rol = Rol(tipo_rol=TipoRol.REPRESENTANTE, descripcion="Representante")
        sesion.add(rol)
        sesion.flush()
    usuario = Usuario(
        correo=f"rep{cedula}@cataclub.test", contrasenia="hash",
        persona_id=persona.id, roles=[rol],
    )
    sesion.add(usuario)
    sesion.flush()
    return persona


def _crear_representado(sesion, representante: Persona, cedula: str) -> Persona:
    """Menor representado: sin `Usuario` propio (issue #1137)."""
    persona = Persona(
        nombres="Nico", apellidos="Reyes", cedula=cedula,
        fecha_nacimiento=date(2015, 3, 1), telefono="0991234567",
        representante_id=representante.id,
    )
    sesion.add(persona)
    sesion.flush()
    return persona


def _aprobar_primer_pago(db_session, membresia, *, solicitante_id, roles_solicitante, admin_id) -> None:
    pago_servicio = PagoServicio(db_session)
    pago = pago_servicio.registrar_pago(
        PagoCreateDTO(
            meses=1, tipo_pago=TipoPago.EFECTIVO,
            persona_id=membresia.persona_id, membresia_id=membresia.id,
        ),
        persona_id_solicitante=solicitante_id, roles_solicitante=roles_solicitante,
    )
    pago_servicio.validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin_id,
    )
    db_session.refresh(membresia)


def _rechazar_primer_pago(db_session, membresia, *, solicitante_id, roles_solicitante, admin_id) -> None:
    pago_servicio = PagoServicio(db_session)
    pago = pago_servicio.registrar_pago(
        PagoCreateDTO(
            meses=1, tipo_pago=TipoPago.EFECTIVO,
            persona_id=membresia.persona_id, membresia_id=membresia.id,
        ),
        persona_id_solicitante=solicitante_id, roles_solicitante=roles_solicitante,
    )
    pago_servicio.validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.RECHAZADO, motivo_rechazo="sin fondos"),
        actor_persona_id=admin_id,
    )
    db_session.refresh(membresia)


# --- El predicado único: ACTIVA, nunca el rol -------------------------------

def test_active_membership_is_the_only_player_predicate(db_session):
    """Un representante con representados matriculado a sí mismo: conserva
    EXACTAMENTE un rol (REPRESENTANTE), el trigger #762 no dispara, y el
    predicado único dice "jugador" mirando SOLO la membresía."""
    admin = crear_persona_orm(db_session, cedula_valida(760), telefono="0990000760")
    representante = _crear_representante_con_usuario(db_session, cedula_valida(761))
    _crear_representado(db_session, representante, cedula_valida(762))
    tipo = crear_tipo_membresia_orm(db_session, categoria="Adultos")

    membresia = MembresiaServicio(db_session).crear_membresia(
        MembresiaCreateDTO(persona_id=representante.id, tipo_membresia_id=tipo.id)
    )
    _aprobar_primer_pago(
        db_session, membresia,
        solicitante_id=representante.id, roles_solicitante=["REPRESENTANTE"], admin_id=admin.id,
    )

    usuario = db_session.query(Usuario).filter(Usuario.persona_id == representante.id).one()
    assert {rol.tipo_rol for rol in usuario.roles} == {TipoRol.REPRESENTANTE}
    assert membresia.estado == EstadoMembresia.ACTIVA
    assert es_jugador([membresia]) is True
    assert MembresiaRepositorio(db_session).tiene_membresia_activa(representante.id) is True


def test_representative_with_approved_own_membership_appears_as_player(db_session):
    """El predicado/consulta que alimenta el listado de Miembros: una
    membresía ACTIVA basta, sin importar el rol de la persona."""
    admin = crear_persona_orm(db_session, cedula_valida(763), telefono="0990000763")
    representante = _crear_representante_con_usuario(db_session, cedula_valida(764))
    tipo = crear_tipo_membresia_orm(db_session, categoria="Adultos")

    membresia = MembresiaServicio(db_session).crear_membresia(
        MembresiaCreateDTO(persona_id=representante.id, tipo_membresia_id=tipo.id)
    )
    assert MembresiaRepositorio(db_session).tiene_membresia_activa(representante.id) is False

    _aprobar_primer_pago(
        db_session, membresia,
        solicitante_id=representante.id, roles_solicitante=["REPRESENTANTE"], admin_id=admin.id,
    )

    assert MembresiaRepositorio(db_session).tiene_membresia_activa(representante.id) is True


def test_representante_sin_membresia_no_es_jugador(db_session):
    representante = _crear_representante_con_usuario(db_session, cedula_valida(765))

    assert MembresiaRepositorio(db_session).tiene_membresia_activa(representante.id) is False
    assert es_jugador([]) is False


def test_el_representado_sigue_la_misma_regla_que_el_representante(db_session):
    """"El alumno representado sigue la misma regla": aprobado -> jugador,
    sin que nadie mire si tiene `Usuario`."""
    admin = crear_persona_orm(db_session, cedula_valida(766), telefono="0990000766")
    representante = _crear_representante_con_usuario(db_session, cedula_valida(767))
    representado = _crear_representado(db_session, representante, cedula_valida(768))
    tipo = crear_tipo_membresia_orm(db_session, categoria="Infantil")

    membresia = MembresiaServicio(db_session).crear_membresia(
        MembresiaCreateDTO(persona_id=representado.id, tipo_membresia_id=tipo.id)
    )
    assert MembresiaRepositorio(db_session).tiene_membresia_activa(representado.id) is False

    _aprobar_primer_pago(
        db_session, membresia,
        solicitante_id=representante.id, roles_solicitante=["REPRESENTANTE"], admin_id=admin.id,
    )

    assert MembresiaRepositorio(db_session).tiene_membresia_activa(representado.id) is True


# --- Sin Usuario no es un camino más laxo ------------------------------------

def test_una_persona_sin_usuario_no_se_matricula_por_un_camino_mas_laxo(db_session):
    """`crear_membresia` ya no consulta ni muta roles: el resultado es
    idéntico con o sin `Usuario` asociado -- ni una asignación de más, ni
    un rechazo de menos."""
    representante = _crear_representante_con_usuario(db_session, cedula_valida(769))
    representado = _crear_representado(db_session, representante, cedula_valida(770))
    tipo = crear_tipo_membresia_orm(db_session, categoria="Infantil")

    membresia = MembresiaServicio(db_session).crear_membresia(
        MembresiaCreateDTO(persona_id=representado.id, tipo_membresia_id=tipo.id)
    )

    assert membresia.estado == EstadoMembresia.INACTIVA
    assert db_session.query(Usuario).filter(Usuario.persona_id == representado.id).count() == 0


# --- Horario/asistencia: pendiente o rechazado no habilita ------------------

def test_pending_or_rejected_payment_does_not_enable_schedule_or_attendance(db_session):
    admin = crear_persona_orm(db_session, cedula_valida(771), telefono="0990000771")
    representante = _crear_representante_con_usuario(db_session, cedula_valida(772))
    tipo = crear_tipo_membresia_orm(db_session, categoria="Adultos")
    asistencia_servicio = AsistenciaServicio(db_session)
    horario = asistencia_servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    # Pendiente: la membresía nace INACTIVA y sigue así sin ningún pago aprobado.
    membresia = MembresiaServicio(db_session).crear_membresia(
        MembresiaCreateDTO(persona_id=representante.id, tipo_membresia_id=tipo.id)
    )
    assert membresia.estado == EstadoMembresia.INACTIVA

    with pytest.raises(OperacionInvalida):
        asistencia_servicio.asignar_alumno_a_horario(
            AlumnoHorarioCreateDTO(persona_id=representante.id, horario_id=horario.id)
        )

    # Rechazado: sigue INACTIVA (nunca se activó), sigue fuera.
    _rechazar_primer_pago(
        db_session, membresia,
        solicitante_id=representante.id, roles_solicitante=["REPRESENTANTE"], admin_id=admin.id,
    )
    assert membresia.estado == EstadoMembresia.INACTIVA

    with pytest.raises(OperacionInvalida):
        asistencia_servicio.asignar_alumno_a_horario(
            AlumnoHorarioCreateDTO(persona_id=representante.id, horario_id=horario.id)
        )

    # Aprobado: ACTIVA, y ahora sí se habilita.
    _aprobar_primer_pago(
        db_session, membresia,
        solicitante_id=representante.id, roles_solicitante=["REPRESENTANTE"], admin_id=admin.id,
    )
    assert membresia.estado == EstadoMembresia.ACTIVA

    respuesta = asistencia_servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=representante.id, horario_id=horario.id)
    )
    assert len(respuesta.asignaciones) == 1


def test_sin_ninguna_membresia_tampoco_habilita_horario(db_session):
    """Ancla: nunca haber pagado nada bloquea igual que un pago pendiente."""
    persona = crear_persona_orm(db_session, cedula_valida(773))
    servicio = AsistenciaServicio(db_session)
    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    with pytest.raises(OperacionInvalida):
        servicio.asignar_alumno_a_horario(
            AlumnoHorarioCreateDTO(persona_id=persona.id, horario_id=horario.id)
        )
