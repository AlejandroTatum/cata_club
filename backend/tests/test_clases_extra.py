from app.dominio.modelos import Usuario, Rol
from app.dominio.enums import TipoRol
from app.seguridad.gestor_auth import GestorAutenticacion


def _crear_persona_api(client, cedula="1710034065"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_entrenador(client, db_session, cedula="1710034073"):
    persona = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Carlos", "apellidos": "Ruiz", "cedula": cedula,
            "fecha_nacimiento": "1990-01-01", "telefono": "0991112222",
        },
    ).json()
    rol = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")
    usuario = Usuario(
        correo=f"entrenador{persona['id']}@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("clave123"),
        persona_id=persona["id"], roles=[rol],
    )
    db_session.add(usuario)
    db_session.commit()
    return persona


def _crear_membresia(client, persona_id, modalidad):
    tipo = client.post(
        "/api/v1/membresias/tipos",
        json={"categoria": "Adultos", "franja_horaria": "18:00-19:00", "precio": "50.00", "modalidad": modalidad},
    ).json()
    return client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "50.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona_id, "tipo_membresia_id": tipo["id"],
        },
    ).json()


def _crear_horario(client, db_session):
    entrenador = _crear_entrenador(client, db_session)
    return client.post(
        "/api/v1/asistencias/horarios",
        json={
            "dia_semana": "MARTES", "hora_inicio": "17:00:00", "hora_fin": "18:00:00",
            "entrenador_id": entrenador["id"], "categoria": "JUVENIL",
        },
    ).json()


def test_solicitar_clase_extra_en_membresia_personalizada(client, db_session):
    persona = _crear_persona_api(client)
    membresia = _crear_membresia(client, persona["id"], "PERSONALIZADA")
    horario = _crear_horario(client, db_session)

    resp = client.post(
        "/api/v1/clases-extra/",
        json={
            "fecha_clase_solicitada": "2026-07-14",
            "persona_id": persona["id"], "membresia_id": membresia["id"], "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 201
    assert resp.json()["estado"] == "PENDIENTE"


def test_membresia_mensual_no_puede_pedir_clase_extra(client, db_session):
    """Regla de negocio: MENSUAL ya incluye todo el horario mensual."""
    persona = _crear_persona_api(client)
    membresia = _crear_membresia(client, persona["id"], "MENSUAL")
    horario = _crear_horario(client, db_session)

    resp = client.post(
        "/api/v1/clases-extra/",
        json={
            "fecha_clase_solicitada": "2026-07-14",
            "persona_id": persona["id"], "membresia_id": membresia["id"], "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 400
    assert "PERSONALIZADA" in resp.json()["detail"]


def test_aprobar_clase_extra_requiere_costo_adicional(client, db_session):
    persona = _crear_persona_api(client)
    membresia = _crear_membresia(client, persona["id"], "PERSONALIZADA")
    horario = _crear_horario(client, db_session)
    solicitud = client.post(
        "/api/v1/clases-extra/",
        json={
            "fecha_clase_solicitada": "2026-07-14",
            "persona_id": persona["id"], "membresia_id": membresia["id"], "horario_id": horario["id"],
        },
    ).json()

    resp = client.patch(f"/api/v1/clases-extra/{solicitud['id']}/resolver", json={"estado": "APROBADA"})
    assert resp.status_code == 400

    resp = client.patch(
        f"/api/v1/clases-extra/{solicitud['id']}/resolver",
        json={"estado": "APROBADA", "costo_adicional": "8.50"},
    )
    assert resp.status_code == 200
    assert resp.json()["estado"] == "APROBADA"
    assert resp.json()["costoAdicional"] == "8.50"


def test_listar_pendientes_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/clases-extra/pendientes")
    assert resp.status_code == 403


def test_listar_pendientes_incluye_datos_enriquecidos(client, db_session):
    persona = _crear_persona_api(client)
    membresia = _crear_membresia(client, persona["id"], "PERSONALIZADA")
    horario = _crear_horario(client, db_session)
    solicitud = client.post(
        "/api/v1/clases-extra/",
        json={
            "fecha_clase_solicitada": "2026-07-14",
            "persona_id": persona["id"], "membresia_id": membresia["id"], "horario_id": horario["id"],
        },
    ).json()

    resp = client.get("/api/v1/clases-extra/pendientes")
    assert resp.status_code == 200
    pendientes = resp.json()
    assert len(pendientes) == 1
    item = pendientes[0]
    assert item["id"] == solicitud["id"]
    assert item["personaId"] == persona["id"]
    assert item["personaNombreCompleto"] == f"{persona['nombres']} {persona['apellidos']}"
    assert item["horarioId"] == horario["id"]
    assert item["horarioDiaSemana"] == "MARTES"
    assert item["horarioHoraInicio"] == "17:00:00"
    assert item["horarioHoraFin"] == "18:00:00"


def test_listar_pendientes_excluye_aprobadas_y_rechazadas(client, db_session):
    persona = _crear_persona_api(client)
    membresia = _crear_membresia(client, persona["id"], "PERSONALIZADA")
    horario = _crear_horario(client, db_session)
    solicitud = client.post(
        "/api/v1/clases-extra/",
        json={
            "fecha_clase_solicitada": "2026-07-14",
            "persona_id": persona["id"], "membresia_id": membresia["id"], "horario_id": horario["id"],
        },
    ).json()
    client.patch(
        f"/api/v1/clases-extra/{solicitud['id']}/resolver",
        json={"estado": "APROBADA", "costo_adicional": "8.50"},
    )

    resp = client.get("/api/v1/clases-extra/pendientes")
    assert resp.status_code == 200
    assert resp.json() == []
