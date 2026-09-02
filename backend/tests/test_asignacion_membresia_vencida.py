"""INS-6: asignar un alumno con la cuota vencida a un horario no debe
bloquearse -- decisión de negocio #4 (2026-08-11): "La cuota vencida no
impide entrenar". El chico entrena y la cuota se regulariza aparte; lo único
que cambia es que el admin ve un aviso NO BLOQUEANTE al asignarlo.

Alcance deliberadamente excluido (ver INS-6b en `docs/archive/audits/2026-08-10/README.md`):
ninguna validación de edad-vs-categoria -- `rango_edad` es copy de
orientación en este proyecto, no una regla."""
from datetime import date, datetime, timezone
from decimal import Decimal

from app.dominio.enums import EstadoMembresia, EstadoPago, TipoModalidad, TipoPago
from app.dominio.modelos import Membresia, Pago, Persona, TipoMembresia
from app.servicios_negocio.dtos.asistencia_schemas import (
    AlumnoHorarioCreateDTO, HorarioCreateDTO,
)
from app.servicios_negocio import asistencia_servicio as asistencia_servicio_mod
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from app.dominio.enums import Categoria, DiaSemana


def _crear_persona(sesion, cedula: str = "1710034065") -> Persona:
    persona = Persona(
        nombres="Ariana", apellidos="Ruiz", cedula=cedula,
        fecha_nacimiento=date(2012, 3, 1), telefono="0991234567",
    )
    sesion.add(persona)
    sesion.flush()
    return persona


def _crear_membresia(
    sesion, persona: Persona, estado: EstadoMembresia, *, fecha_activacion=None,
) -> Membresia:
    tipo = TipoMembresia(categoria="Mensual Infantil", precio=Decimal("25.00"), modalidad=TipoModalidad.MENSUAL)
    sesion.add(tipo)
    sesion.flush()
    membresia = Membresia(
        estado=estado, monto_aplicado=Decimal("25.00"),
        fecha_activacion=fecha_activacion or datetime.now(timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    sesion.add(membresia)
    sesion.flush()
    return membresia


def _crear_pago_aprobado(sesion, persona: Persona, membresia: Membresia, fecha_fin: date) -> Pago:
    pago = Pago(
        monto=Decimal("25.00"), estado_pago=EstadoPago.APROBADO, tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(fecha_fin.year, fecha_fin.month, 1), fecha_fin=fecha_fin,
        persona_id=persona.id, membresia_id=membresia.id,
    )
    sesion.add(pago)
    sesion.flush()
    return pago


def test_asignar_alumno_con_membresia_vencida_igual_lo_asigna(db_session, monkeypatch):
    """El asignar NO se bloquea por cuota vencida -- decisión de negocio #4."""
    monkeypatch.setattr(asistencia_servicio_mod, "hoy_club", lambda: date(2026, 8, 15))
    servicio = AsistenciaServicio(db_session)
    persona = _crear_persona(db_session)
    membresia = _crear_membresia(db_session, persona, EstadoMembresia.VENCIDA)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 8, 1))
    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    respuesta = servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=persona.id, horario_id=horario.id)
    )

    assert len(respuesta.asignaciones) == 1


def test_asignar_alumno_con_membresia_vencida_marca_el_aviso_con_dias(db_session, monkeypatch):
    monkeypatch.setattr(asistencia_servicio_mod, "hoy_club", lambda: date(2026, 8, 15))
    servicio = AsistenciaServicio(db_session)
    persona = _crear_persona(db_session)
    membresia = _crear_membresia(db_session, persona, EstadoMembresia.VENCIDA)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 8, 1))
    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    respuesta = servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=persona.id, horario_id=horario.id)
    )

    assert respuesta.membresia_vencida is True
    assert respuesta.dias_vencida == 14


def test_asignar_alumno_con_membresia_activa_no_marca_el_aviso(db_session, monkeypatch):
    monkeypatch.setattr(asistencia_servicio_mod, "hoy_club", lambda: date(2026, 8, 15))
    servicio = AsistenciaServicio(db_session)
    persona = _crear_persona(db_session)
    _crear_membresia(db_session, persona, EstadoMembresia.ACTIVA)
    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    respuesta = servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=persona.id, horario_id=horario.id)
    )

    assert respuesta.membresia_vencida is False
    assert respuesta.dias_vencida is None


def test_asignar_alumno_sin_ninguna_membresia_no_marca_el_aviso(db_session, monkeypatch):
    monkeypatch.setattr(asistencia_servicio_mod, "hoy_club", lambda: date(2026, 8, 15))
    servicio = AsistenciaServicio(db_session)
    persona = _crear_persona(db_session)
    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    respuesta = servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=persona.id, horario_id=horario.id)
    )

    assert respuesta.membresia_vencida is False
    assert respuesta.dias_vencida is None


def test_asignar_alumno_con_membresia_inactiva_no_marca_el_aviso(db_session, monkeypatch):
    """Alcance deliberado: INACTIVA (nunca se activó / sin pago aprobado
    todavía) es un estado distinto de VENCIDA (se activó y expiró). La
    decisión de negocio #4 habla de "cuota vencida", no de "nunca pagó" --
    no se trata como vencida acá."""
    monkeypatch.setattr(asistencia_servicio_mod, "hoy_club", lambda: date(2026, 8, 15))
    servicio = AsistenciaServicio(db_session)
    persona = _crear_persona(db_session)
    _crear_membresia(db_session, persona, EstadoMembresia.INACTIVA)
    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    respuesta = servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=persona.id, horario_id=horario.id)
    )

    assert respuesta.membresia_vencida is False


def test_asignar_alumno_mira_la_membresia_mas_reciente(db_session, monkeypatch):
    """Triangulación: si la persona tiene una VENCIDA vieja y una ACTIVA más
    reciente (renovó), el aviso no debe dispararse -- la vigente es la que
    manda, no cualquier fila histórica."""
    monkeypatch.setattr(asistencia_servicio_mod, "hoy_club", lambda: date(2026, 8, 15))
    servicio = AsistenciaServicio(db_session)
    persona = _crear_persona(db_session)
    _crear_membresia(
        db_session, persona, EstadoMembresia.VENCIDA,
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    _crear_membresia(
        db_session, persona, EstadoMembresia.ACTIVA,
        fecha_activacion=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )
    horario = servicio.crear_horario(HorarioCreateDTO(
        categoria=Categoria.FORMATIVO, dia_semana=DiaSemana.LUNES,
    ))

    respuesta = servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=persona.id, horario_id=horario.id)
    )

    assert respuesta.membresia_vencida is False
