"""Tests de los reportes agregados: asistencia por horario/periodo/alumno
(E02-RF005) y alumnos nuevos por periodo (E04-RF014)."""


def _crear_persona(client, cedula):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Test", "apellidos": cedula, "cedula": cedula,
            "fecha_nacimiento": "2000-05-14", "telefono": "0991234567",
        },
    ).json()


def test_reporte_asistencia_requiere_admin_o_entrenador(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/asistencias/reportes")
    assert resp.status_code == 403


def test_reporte_asistencia_filtra_por_horario_y_periodo(client):
    entrenador = _crear_persona(client, "1751515151")
    alumno = _crear_persona(client, "1751515152")
    client.post("/api/v1/auth/registro", json={
        "cedula": entrenador["cedula"], "correo": "ent@x.com", "contrasenia": "password123",
    })
    client.post(f"/api/v1/personas/{entrenador['id']}/roles", json={"tipo_rol": "ENTRENADOR"})

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "dia_semana": "LUNES", "hora_inicio": "08:00:00", "hora_fin": "09:00:00",
            "entrenador_id": entrenador["id"], "categoria": "FORMATIVO",
        },
    ).json()

    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": "2026-07-06", "estado": "PRESENTE",
            "persona_id": alumno["id"], "entrenador_id": entrenador["id"], "horario_id": horario["id"],
        },
    )
    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": "2026-08-06", "estado": "AUSENTE",
            "persona_id": alumno["id"], "entrenador_id": entrenador["id"], "horario_id": horario["id"],
        },
    )

    resp = client.get(
        "/api/v1/asistencias/reportes",
        params={"horario_id": horario["id"], "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["estado"] == "PRESENTE"


def test_reporte_alumnos_nuevos_por_periodo(client):
    _crear_persona(client, "1761616161")
    resp = client.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_reporte_alumnos_nuevos_por_periodo_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get(
        "/api/v1/personas/reportes/nuevos-por-periodo",
        params={"fecha_inicio": "2026-01-01", "fecha_fin": "2026-12-31"},
    )
    assert resp.status_code == 403
