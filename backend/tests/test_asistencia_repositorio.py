"""
`AlumnoHorarioRepositorio.listar_por_horario` alimenta la lista de alumnos de
un horario sin declarar ningún `ORDER BY`: el orden en pantalla quedaba a
criterio del motor. El listado se lee como una nómina de clase, así que el
orden esperado es por apellidos y nombres del alumno, con el id de la
asignación como desempate.
"""
from datetime import date, time

from sqlalchemy import func, select

from app.dominio.cedula import cedula_valida
from app.dominio.enums import Categoria, DiaSemana
from app.dominio.modelos import AlumnoHorario, HorarioEntrenamiento, Persona, SesionAsistencia
from app.infraestructura.repositorios.asistencia_repositorio import (
    AlumnoHorarioRepositorio, SesionAsistenciaRepositorio,
)


def _crear_persona(db_session, cedula: str, nombres: str, apellidos: str) -> Persona:
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    return persona


def _crear_horario(db_session) -> HorarioEntrenamiento:
    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES,
        hora_inicio=time(18, 0), hora_fin=time(19, 30),
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
    for cedula in ("1710034511", cedula_valida(130), cedula_valida(131)):
        persona = _crear_persona(db_session, cedula, "Ana", "Torres")
        asignacion = AlumnoHorario(persona_id=persona.id, horario_id=horario.id)
        db_session.add(asignacion)
        db_session.flush()
        asignaciones_creadas.append(asignacion)
    db_session.commit()

    asignaciones = AlumnoHorarioRepositorio(db_session).listar_por_horario(horario.id)

    assert [a.id for a in asignaciones] == [a.id for a in asignaciones_creadas]


# ---------------------------------------------------------------------------
# Issue #389, slice 1: cierre atómico de sesión (`SesionAsistencia`).
# `SesionAsistenciaRepositorio.obtener_o_crear_cerrada` es un get-or-create
# race-safe -- ver su docstring en asistencia_repositorio.py.
# ---------------------------------------------------------------------------


def test_obtener_o_crear_cerrada_crea_en_el_primer_llamado(db_session):
    horario = _crear_horario(db_session)
    persona = _crear_persona(db_session, cedula_valida(160), "Ana", "Torres")
    db_session.flush()
    fecha = date(2026, 7, 13)

    repo = SesionAsistenciaRepositorio(db_session)
    sesion = repo.obtener_o_crear_cerrada(horario.id, fecha, persona.id)
    db_session.commit()

    assert sesion.id is not None
    assert sesion.horario_id == horario.id
    assert sesion.fecha_entrenamiento == fecha
    assert sesion.cerrada_por_id == persona.id
    assert sesion.cerrada_en is not None

    # Segundo llamado para el MISMO par: devuelve la fila existente, no
    # duplica.
    repetida = repo.obtener_o_crear_cerrada(horario.id, fecha, persona.id)
    assert repetida.id == sesion.id


def test_obtener_o_crear_cerrada_relee_tras_choque_de_unique(db_session, monkeypatch):
    """Simula la carrera: otra fila para el mismo par YA existe cuando el
    repo intenta insertar. Debe atrapar el `IntegrityError` del
    `uq_sesion_asistencia_horario_fecha` y releer la fila ganadora en vez
    de duplicarla o propagar el error."""
    horario = _crear_horario(db_session)
    ganador = _crear_persona(db_session, cedula_valida(161), "Ana", "Torres")
    tardio = _crear_persona(db_session, cedula_valida(162), "Beto", "Ruiz")
    db_session.flush()
    fecha = date(2026, 7, 13)

    repo = SesionAsistenciaRepositorio(db_session)
    fila_ganadora = SesionAsistencia(
        horario_id=horario.id, fecha_entrenamiento=fecha, cerrada_por_id=ganador.id,
    )
    db_session.add(fila_ganadora)
    db_session.flush()

    # Fuerza que la búsqueda inicial del repo NO vea la fila ganadora en su
    # primera llamada -- solo ahí, para no enmascarar el resto del método.
    buscar_real = repo.buscar_por_horario_fecha
    llamados = {"n": 0}

    def _ciego_una_vez(horario_id, fecha_entrenamiento):
        llamados["n"] += 1
        if llamados["n"] == 1:
            return None
        return buscar_real(horario_id, fecha_entrenamiento)

    monkeypatch.setattr(repo, "buscar_por_horario_fecha", _ciego_una_vez)

    resultado = repo.obtener_o_crear_cerrada(horario.id, fecha, tardio.id)

    assert resultado.id == fila_ganadora.id
    assert resultado.cerrada_por_id == ganador.id  # el "tardío" no la pisó

    total = db_session.execute(
        select(func.count()).select_from(SesionAsistencia).where(
            SesionAsistencia.horario_id == horario.id,
            SesionAsistencia.fecha_entrenamiento == fecha,
        )
    ).scalar_one()
    assert total == 1  # nunca hubo dos filas para el mismo par
