"""
`AlumnoHorarioRepositorio.listar_por_horario` alimenta la lista de alumnos de
un horario sin declarar ningún `ORDER BY`: el orden en pantalla quedaba a
criterio del motor. El listado se lee como una nómina de clase, así que el
orden esperado es por apellidos y nombres del alumno, con el id de la
asignación como desempate.
"""
from datetime import date, time

from app.dominio.enums import Categoria, DiaSemana
from app.dominio.modelos import AlumnoHorario, HorarioEntrenamiento, Persona
from app.infraestructura.repositorios.asistencia_repositorio import (
    AlumnoHorarioRepositorio,
)
from tests.conftest import crear_entrenador


def _crear_persona(db_session, cedula: str, nombres: str, apellidos: str) -> Persona:
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    return persona


def _crear_horario(db_session) -> HorarioEntrenamiento:
    entrenador_id = crear_entrenador(db_session, cedula="1710034500")
    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES,
        hora_inicio=time(18, 0), hora_fin=time(19, 30),
        entrenador_id=entrenador_id,
    )
    db_session.add(horario)
    db_session.flush()
    return horario


def test_listar_por_horario_ordena_por_apellidos_y_nombres(db_session):
    horario = _crear_horario(db_session)
    # Insertados en orden INVERSO al alfabético: un listado sin `ORDER BY`
    # devolvería el orden físico de inserción y no pasaría esta aserción.
    for cedula, nombres, apellidos in (
        ("1710034501", "Zoe", "Zambrano"),
        ("1710034502", "Mario", "Mendoza"),
        ("1710034503", "Beatriz", "Alvarez"),
    ):
        persona = _crear_persona(db_session, cedula, nombres, apellidos)
        db_session.add(AlumnoHorario(persona_id=persona.id, horario_id=horario.id))
    db_session.commit()

    asignaciones = AlumnoHorarioRepositorio(db_session).listar_por_horario(horario.id)

    assert [a.persona.apellidos for a in asignaciones] == [
        "Alvarez", "Mendoza", "Zambrano",
    ]


def test_listar_por_horario_desempata_por_id_de_asignacion(db_session):
    horario = _crear_horario(db_session)
    asignaciones_creadas = []
    for cedula in ("1710034511", "1710034512", "1710034513"):
        persona = _crear_persona(db_session, cedula, "Ana", "Torres")
        asignacion = AlumnoHorario(persona_id=persona.id, horario_id=horario.id)
        db_session.add(asignacion)
        db_session.flush()
        asignaciones_creadas.append(asignacion)
    db_session.commit()

    asignaciones = AlumnoHorarioRepositorio(db_session).listar_por_horario(horario.id)

    assert [a.id for a in asignaciones] == [a.id for a in asignaciones_creadas]
