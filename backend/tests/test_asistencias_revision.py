"""ENT-07: asistencia de alumnos no operativos o anteriores a su inscripción.

Se permite (decisión de producto), pero la fila queda marcada
`requiere_revision` para que el admin la revise.
"""
from datetime import timedelta

from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import AlumnoHorario, Asistencia, Membresia, Persona
from app.soporte_transversal.tiempo import ahora_club
from tests.test_asistencias_lote import URL, _cuerpo, _escenario


def _inscribir_hace_mucho(db_session, alumno):
    """La inscripción de los fixtures nace hoy; la retrocede para que la fecha
    de la sesión no sea anterior a ella."""
    db_session.query(AlumnoHorario).filter_by(persona_id=alumno["id"]).update(
        {"fecha_asignacion": ahora_club() - timedelta(days=90)}
    )
    db_session.flush()


def _revision_de(client, horario, alumno):
    items = client.get(
        "/api/v1/asistencias/reportes", params={"horario_id": horario["id"]},
    ).json()["items"]
    return next(i for i in items if i["personaId"] == alumno["id"])["requiereRevision"]


def test_alumno_operativo_inscripto_antes_de_la_sesion_no_se_marca(client, db_session):
    horario, alumnos, fecha = _escenario(client, 1)
    _inscribir_hace_mucho(db_session, alumnos[0])

    resp = client.post(URL, json=_cuerpo(horario, fecha, alumnos))

    assert resp.json()["creados"] == 1
    assert _revision_de(client, horario, alumnos[0]) is False


def test_sesion_anterior_a_la_inscripcion_se_acepta_y_se_marca(client, db_session):
    horario, alumnos, fecha = _escenario(client, 1)
    # Inscripto HOY; la sesión es de un lunes anterior (o de hoy mismo si hoy es
    # lunes: en ese caso se adelanta la inscripción un día).
    db_session.query(AlumnoHorario).filter_by(persona_id=alumnos[0]["id"]).update(
        {"fecha_asignacion": ahora_club() + timedelta(days=1)}
    )
    db_session.flush()

    resp = client.post(URL, json=_cuerpo(horario, fecha, alumnos))

    assert resp.json()["creados"] == 1
    assert _revision_de(client, horario, alumnos[0]) is True


def test_alumno_con_membresia_suspendida_se_acepta_y_se_marca(client, db_session):
    horario, alumnos, fecha = _escenario(client, 2)
    for alumno in alumnos:
        _inscribir_hace_mucho(db_session, alumno)
    db_session.query(Membresia).filter_by(persona_id=alumnos[0]["id"]).update(
        {"estado": EstadoMembresia.SUSPENDIDA}
    )
    db_session.flush()

    resp = client.post(URL, json=_cuerpo(horario, fecha, alumnos))

    assert resp.json()["creados"] == 2
    assert _revision_de(client, horario, alumnos[0]) is True
    assert _revision_de(client, horario, alumnos[1]) is False


def test_alumno_dado_de_baja_se_acepta_y_se_marca(client, db_session):
    horario, alumnos, fecha = _escenario(client, 1)
    _inscribir_hace_mucho(db_session, alumnos[0])
    db_session.query(Persona).filter_by(id=alumnos[0]["id"]).update({"activo": False})
    db_session.flush()

    resp = client.post(URL, json=_cuerpo(horario, fecha, alumnos))

    assert resp.json()["creados"] == 1
    assert _revision_de(client, horario, alumnos[0]) is True


def test_registro_individual_tambien_marca_la_fila(client, db_session):
    horario, alumnos, fecha = _escenario(client, 1)
    _inscribir_hace_mucho(db_session, alumnos[0])
    db_session.query(Membresia).filter_by(persona_id=alumnos[0]["id"]).update(
        {"estado": EstadoMembresia.SUSPENDIDA}
    )
    db_session.flush()

    resp = client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": fecha, "estado": "PRESENTE",
            "persona_id": alumnos[0]["id"], "horario_id": horario["id"],
        },
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["requiereRevision"] is True
    assert db_session.query(Asistencia).one().requiere_revision is True
