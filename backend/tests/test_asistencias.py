from app.dominio.modelos import Persona, Usuario, Rol
from app.dominio.enums import TipoRol
from app.seguridad.gestor_auth import GestorAutenticacion
from datetime import date


def _crear_persona_api(client, cedula="1710034065", nombres="Ana"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": nombres, "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def _convertir_en_entrenador(db_session, persona_id: int):
    """Da de alta un Usuario con rol ENTRENADOR para una Persona ya creada
    (no existe aún un endpoint de registro de usuarios; se hace vía ORM
    directamente en el test, igual que lo haría un seed/migración)."""
    rol = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador del club")
    usuario = Usuario(
        correo=f"entrenador{persona_id}@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("clave123"),
        persona_id=persona_id,
        roles=[rol],
    )
    db_session.add(usuario)
    db_session.commit()


def test_no_permite_horario_con_entrenador_sin_rol(client):
    """Persona sin rol ENTRENADOR no puede quedar como titular de un horario."""
    persona = _crear_persona_api(client)
    resp = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "dia_semana": "LUNES", "hora_inicio": "18:00:00", "hora_fin": "19:00:00",
            "entrenador_id": persona["id"], "categoria": "COMPETITIVO",
        },
    )
    assert resp.status_code == 400
    assert "ENTRENADOR" in resp.json()["detail"]


def test_crear_horario_con_entrenador_valido(client, db_session):
    entrenador = _crear_persona_api(client, "1710034065", "Carlos")
    _convertir_en_entrenador(db_session, entrenador["id"])

    resp = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "dia_semana": "LUNES", "hora_inicio": "18:00:00", "hora_fin": "19:00:00",
            "entrenador_id": entrenador["id"], "categoria": "COMPETITIVO",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["diaSemana"] == "LUNES"
    assert resp.json()["entrenadorId"] == entrenador["id"]


def test_asistencia_permite_entrenador_sustituto_distinto_al_titular(client, db_session):
    """Regla de negocio confirmada: el entrenador titular del horario puede
    cambiar puntualmente por sustitución -- Asistencia.entrenador_id puede
    diferir de HorarioEntrenamiento.entrenador_id."""
    titular = _crear_persona_api(client, "1710034065", "Carlos")
    _convertir_en_entrenador(db_session, titular["id"])
    sustituto = _crear_persona_api(client, "1710034073", "Diego")
    _convertir_en_entrenador(db_session, sustituto["id"])
    alumno = _crear_persona_api(client, "1710034081", "Ana")

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "dia_semana": "LUNES", "hora_inicio": "18:00:00", "hora_fin": "19:00:00",
            "entrenador_id": titular["id"], "categoria": "COMPETITIVO",
        },
    ).json()

    resp = client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
            "persona_id": alumno["id"], "entrenador_id": sustituto["id"],
            "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 201
    assert resp.json()["entrenadorId"] == sustituto["id"]
    assert resp.json()["entrenadorId"] != horario["entrenadorId"]
