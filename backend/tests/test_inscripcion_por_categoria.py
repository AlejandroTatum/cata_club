"""The club enrolls by full month, never by loose weekday (owner's rule,
verbatim: "no se debería permitir a un estudiante inscribirse solo unos
días, el club no trabaja de esa manera, se manejan con todo el mes, no por
días"). `HorarioEntrenamiento` still stores one row per categoria × weekday,
but `AsistenciaServicio.asignar_alumno_a_horario`/`desasignar_alumno_de_horario`
now treat a categoria's current rows as one atomic unit: a student lands on
every one of them or none, and there is no request shape that leaves a
subset. COMPETITIVO is deliberately exercised here too, since it is the only
categoria that runs Lunes-Sábado while the other four run Lunes-Viernes."""


def _crear_persona_api(client, cedula="1710034065", nombres="Ana"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": nombres, "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_horario(client, categoria, dia_semana):
    return client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": categoria, "dia_semana": dia_semana},
    ).json()


def _dias_del_alumno(client, persona_id):
    resp = client.get(f"/api/v1/asistencias/alumnos/{persona_id}/horarios")
    assert resp.status_code == 200
    return {fila["horarioDia"] for fila in resp.json()}


def _horarios_del_alumno(client, persona_id):
    resp = client.get(f"/api/v1/asistencias/alumnos/{persona_id}/horarios")
    assert resp.status_code == 200
    return {fila["horarioId"] for fila in resp.json()}


def test_asignar_alumno_lo_inscribe_en_todos_los_horarios_de_la_categoria(client):
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    lunes = _crear_horario(client, "JUVENIL", "LUNES")
    martes = _crear_horario(client, "JUVENIL", "MARTES")

    resp = client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": lunes["id"]},
    )

    assert resp.status_code == 201
    assert _horarios_del_alumno(client, alumno["id"]) == {lunes["id"], martes["id"]}


def test_asignar_alumno_no_deja_forma_de_quedar_en_un_subconjunto(client):
    """No importa por cuál horario puntual de la categoría se dispare el
    alta: el resultado es siempre el conjunto completo. Si quedara algún
    camino para una inscripción parcial, disparar el alta desde el OTRO
    horario del grupo (martes) tras ya estar en ambos rechazaría el pedido en
    vez de dejarlo a medio camino."""
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    lunes = _crear_horario(client, "JUVENIL", "LUNES")
    martes = _crear_horario(client, "JUVENIL", "MARTES")

    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": lunes["id"]},
    )
    segunda = client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": martes["id"]},
    )

    assert segunda.status_code == 400
    assert _horarios_del_alumno(client, alumno["id"]) == {lunes["id"], martes["id"]}


def test_asignar_alumno_ya_inscripto_en_toda_la_categoria_rechaza_sin_vocabulario_interno(client):
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    lunes = _crear_horario(client, "JUVENIL", "LUNES")

    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": lunes["id"]},
    )
    resp = client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": lunes["id"]},
    )

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "Ana Torres" in detail
    assert "horario_id" not in detail
    assert "alumno_horario" not in detail


def test_desasignar_alumno_lo_remueve_de_todos_los_horarios_de_la_categoria(client):
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    lunes = _crear_horario(client, "JUVENIL", "LUNES")
    martes = _crear_horario(client, "JUVENIL", "MARTES")
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": lunes["id"]},
    )
    # Both días must already carry the student before unassigning anything --
    # otherwise the assertions below would pass for the wrong reason (nothing
    # to remove from martes because it was never populated).
    assert _horarios_del_alumno(client, alumno["id"]) == {lunes["id"], martes["id"]}

    resp = client.request(
        "DELETE", "/api/v1/asistencias/desasignar-alumno",
        params={"persona_id": alumno["id"], "horario_id": lunes["id"]},
    )

    assert resp.status_code == 204
    assert _horarios_del_alumno(client, alumno["id"]) == set()
    # Confirms the OTHER día's row is gone too, not just the one addressed
    # in the request -- unassigning "un día" unassigns the whole categoria.
    roster_martes = client.get(f"/api/v1/asistencias/horarios/{martes['id']}/alumnos").json()
    assert roster_martes["items"] == []


def test_asignar_alumno_incluye_sabado_para_competitivo(client):
    """COMPETITIVO corre Lunes-Sábado mientras el resto corre Lunes-Viernes:
    'todos los días de la categoría' tiene que alcanzar al sábado acá."""
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    lunes = _crear_horario(client, "COMPETITIVO", "LUNES")
    sabado = _crear_horario(client, "COMPETITIVO", "SABADO")

    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": lunes["id"]},
    )

    assert _dias_del_alumno(client, alumno["id"]) == {"LUNES", "SABADO"}
    assert _horarios_del_alumno(client, alumno["id"]) == {lunes["id"], sabado["id"]}


def test_asignar_alumno_no_se_desborda_a_otra_categoria(client):
    """El alta atómica es por categoría: no debe alcanzar horarios de una
    categoría distinta, aunque existan al mismo tiempo."""
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    juvenil = _crear_horario(client, "JUVENIL", "LUNES")
    infantil = _crear_horario(client, "INFANTIL", "LUNES")

    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": juvenil["id"]},
    )

    assert _horarios_del_alumno(client, alumno["id"]) == {juvenil["id"]}
    roster_infantil = client.get(f"/api/v1/asistencias/horarios/{infantil['id']}/alumnos").json()
    assert roster_infantil["items"] == []


# --- Eliminar un horario NO es "desasignar de la categoría" ----------------
# Dropping one día from a categoria's schedule (admin editing `/groups`) must
# unassign students from exactly that row, never from the whole categoria --
# the opposite mistake from the one this file guards above.
def test_eliminar_horario_no_requiere_desasignar_antes_y_no_afecta_otro_dia_de_la_categoria(client):
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    lunes = _crear_horario(client, "JUVENIL", "LUNES")
    martes = _crear_horario(client, "JUVENIL", "MARTES")
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": lunes["id"]},
    )
    assert _horarios_del_alumno(client, alumno["id"]) == {lunes["id"], martes["id"]}

    # No explicit unassign call first -- deleting the row alone must succeed
    # even though the student is still enrolled in it.
    resp = client.delete(f"/api/v1/asistencias/horarios/{lunes['id']}")

    assert resp.status_code == 204
    # Removed from the deleted día, but MARTES (the rest of the categoria)
    # keeps the student -- this is the bug the fix closes.
    assert _horarios_del_alumno(client, alumno["id"]) == {martes["id"]}
