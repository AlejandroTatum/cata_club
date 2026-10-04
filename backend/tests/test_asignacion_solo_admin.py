"""QA4 ENT-N1: solo ADMINISTRADOR asigna o desasigna alumnos a categorías.

El ENTRENADOR conserva el resto de sus permisos (asistencia, ver nómina),
pero `asignar-alumno` / `desasignar-alumno` responden 403 con su token.
"""
from tests.test_asistencias import _crear_persona_api, _restaurar_token_entrenador

ASIGNAR = "/api/v1/asistencias/asignar-alumno"
DESASIGNAR = "/api/v1/asistencias/desasignar-alumno"


def _horario(client):
    return client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()


def test_entrenador_no_puede_asignar_alumno(client_entrenador, client):
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    horario = _horario(client)

    _restaurar_token_entrenador()
    resp = client_entrenador.post(
        ASIGNAR, json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )
    assert resp.status_code == 403


def test_entrenador_no_puede_desasignar_alumno(client_entrenador, client):
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    horario = _horario(client)
    assert client.post(
        ASIGNAR, json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    ).status_code == 201

    _restaurar_token_entrenador()
    resp = client_entrenador.request(
        "DELETE", DESASIGNAR,
        params={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )
    assert resp.status_code == 403

    # La asignación sigue en pie para el administrador.
    nomina = client.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")
    assert nomina.json()["total"] == 1


def test_admin_asigna_y_desasigna_alumno(client):
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    horario = _horario(client)

    resp = client.post(
        ASIGNAR, json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )
    assert resp.status_code == 201
    resp = client.request(
        "DELETE", DESASIGNAR,
        params={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )
    assert resp.status_code == 204


def test_entrenador_sigue_viendo_la_nomina(client_entrenador, client):
    horario = _horario(client)
    _restaurar_token_entrenador()
    resp = client_entrenador.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")
    assert resp.status_code == 200
