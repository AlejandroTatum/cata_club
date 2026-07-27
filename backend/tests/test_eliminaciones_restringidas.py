"""
Eliminaciones bloqueadas por datos dependientes (PR-11).

Antes, borrar una Persona o un HorarioEntrenamiento con registros que los
referencian dejaba escapar el `IntegrityError` crudo de SQLAlchemy: el cliente
recibía un 500 sin mensaje útil y el traceback se imprimía en el log del
contenedor. Estas pruebas fijan el contrato nuevo: el repositorio traduce esa
violación de integridad a `OperacionInvalida`, que `main.py` ya mapea a un
HTTP 400 con un mensaje en español que explica qué bloquea el borrado.
"""
from datetime import date, time

import pytest

from app.dominio.enums import Categoria, DiaSemana, EstadoAsistencia
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Asistencia, HorarioEntrenamiento, Persona
from app.infraestructura.repositorios.asistencia_repositorio import HorarioRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from tests.conftest import crear_entrenador as _crear_entrenador


def _crear_alumno(db_session, cedula: str = "1710034099") -> Persona:
    persona = Persona(
        nombres="Ana", apellidos="Vega", cedula=cedula,
        fecha_nacimiento=date(2005, 5, 5), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _crear_horario(db_session, entrenador_id: int) -> HorarioEntrenamiento:
    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES,
        hora_inicio=time(17, 0), hora_fin=time(18, 0), entrenador_id=entrenador_id,
    )
    db_session.add(horario)
    db_session.commit()
    db_session.refresh(horario)
    return horario


def _crear_asistencia(db_session, persona_id: int, entrenador_id: int, horario_id: int) -> Asistencia:
    asistencia = Asistencia(
        fecha_entrenamiento=date(2025, 3, 3), estado=EstadoAsistencia.PRESENTE,
        persona_id=persona_id, entrenador_id=entrenador_id, horario_id=horario_id,
    )
    db_session.add(asistencia)
    db_session.commit()
    db_session.refresh(asistencia)
    return asistencia


# --- Repositorio: la violación de integridad se traduce a dominio ----------
def test_eliminar_persona_con_asistencias_lanza_operacion_invalida(db_session):
    entrenador_id = _crear_entrenador(db_session)
    alumno = _crear_alumno(db_session)
    horario = _crear_horario(db_session, entrenador_id)
    _crear_asistencia(db_session, alumno.id, entrenador_id, horario.id)
    repo = PersonaRepositorio(db_session)

    with pytest.raises(OperacionInvalida) as error:
        repo.eliminar(alumno)

    assert "asistencias" in error.value.mensaje.lower() or "registros" in error.value.mensaje.lower()


def test_eliminar_persona_bloqueada_deja_la_persona_intacta(db_session):
    """La sesión queda usable después del rollback interno: la persona sigue
    existiendo y se puede seguir consultando sin `PendingRollbackError`."""
    entrenador_id = _crear_entrenador(db_session)
    alumno = _crear_alumno(db_session)
    horario = _crear_horario(db_session, entrenador_id)
    _crear_asistencia(db_session, alumno.id, entrenador_id, horario.id)
    repo = PersonaRepositorio(db_session)
    persona_id = alumno.id

    with pytest.raises(OperacionInvalida):
        repo.eliminar(alumno)

    assert repo.obtener_por_id(persona_id) is not None


def test_eliminar_horario_con_asistencias_lanza_operacion_invalida(db_session):
    entrenador_id = _crear_entrenador(db_session)
    alumno = _crear_alumno(db_session)
    horario = _crear_horario(db_session, entrenador_id)
    _crear_asistencia(db_session, alumno.id, entrenador_id, horario.id)
    repo = HorarioRepositorio(db_session)

    with pytest.raises(OperacionInvalida) as error:
        repo.eliminar(horario)

    assert "asistencias" in error.value.mensaje.lower()


def test_eliminar_horario_bloqueado_deja_el_horario_intacto(db_session):
    entrenador_id = _crear_entrenador(db_session)
    alumno = _crear_alumno(db_session)
    horario = _crear_horario(db_session, entrenador_id)
    _crear_asistencia(db_session, alumno.id, entrenador_id, horario.id)
    repo = HorarioRepositorio(db_session)
    horario_id = horario.id

    with pytest.raises(OperacionInvalida):
        repo.eliminar(horario)

    assert repo.obtener_por_id(horario_id) is not None


# --- El borrado sin dependientes sigue funcionando -------------------------
def test_eliminar_persona_sin_dependientes_sigue_borrando(db_session):
    alumno = _crear_alumno(db_session, cedula="1710034077")
    repo = PersonaRepositorio(db_session)
    persona_id = alumno.id

    repo.eliminar(alumno)

    assert repo.obtener_por_id(persona_id) is None


# --- Contrato HTTP: 400 en vez de 500 --------------------------------------
def test_delete_persona_con_asistencias_responde_400(client, db_session):
    entrenador_id = _crear_entrenador(db_session)
    alumno = _crear_alumno(db_session)
    horario = _crear_horario(db_session, entrenador_id)
    _crear_asistencia(db_session, alumno.id, entrenador_id, horario.id)

    respuesta = client.delete(f"/api/v1/personas/{alumno.id}")

    assert respuesta.status_code == 400
    cuerpo = respuesta.json()
    assert cuerpo["detail"] == cuerpo["message"]
    assert "elimin" in cuerpo["message"].lower()


def test_delete_horario_con_asistencias_responde_400(client, db_session):
    entrenador_id = _crear_entrenador(db_session)
    alumno = _crear_alumno(db_session)
    horario = _crear_horario(db_session, entrenador_id)
    _crear_asistencia(db_session, alumno.id, entrenador_id, horario.id)

    respuesta = client.delete(f"/api/v1/asistencias/horarios/{horario.id}")

    assert respuesta.status_code == 400
    assert "asistencias" in respuesta.json()["message"].lower()
