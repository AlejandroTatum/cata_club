from app.dominio.modelos import Persona, Usuario, Rol, NivelRanking, HorarioEntrenamiento
from app.dominio.enums import TipoRol
from app.seguridad.gestor_auth import GestorAutenticacion
from datetime import date, time


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
            "entrenador_id": persona["id"],
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
            "entrenador_id": entrenador["id"],
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
            "entrenador_id": titular["id"],
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


# --- Slice 7: response-only nivel_ranking_id exposure -----------------------
# HorarioEntrenamiento.nivel_ranking_id already exists on the model; these
# tests prove HorarioResponseDTO exposes it (null and set cases) while
# HorarioCreateDTO/POST /asistencias/horarios stay byte-identical (no new
# accepted field) -- see design decision "Schedule→group linkage".


def test_crear_horario_response_incluye_nivel_ranking_id_nulo(client, db_session):
    """Un horario sin nivel de ranking ligado expone nivelRankingId: null."""
    entrenador = _crear_persona_api(client, "1710034065", "Carlos")
    _convertir_en_entrenador(db_session, entrenador["id"])

    resp = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "dia_semana": "LUNES", "hora_inicio": "18:00:00", "hora_fin": "19:00:00",
            "entrenador_id": entrenador["id"],
        },
    )
    assert resp.status_code == 201
    assert "nivelRankingId" in resp.json()
    assert resp.json()["nivelRankingId"] is None


def test_listar_horarios_incluye_nivel_ranking_id_cuando_esta_ligado(client, db_session):
    """Un horario ligado a un nivel (vía ORM, no vía el request de creación)
    debe reflejar ese id en el listado -- prueba el caso con valor."""
    entrenador = _crear_persona_api(client, "1710034065", "Carlos")
    _convertir_en_entrenador(db_session, entrenador["id"])

    nivel = NivelRanking(numero_nivel=1, nombre="Avanzado")
    db_session.add(nivel)
    db_session.commit()

    horario = HorarioEntrenamiento(
        dia_semana="LUNES", hora_inicio=time(18, 0), hora_fin=time(19, 0),
        entrenador_id=entrenador["id"], nivel_ranking_id=nivel.id,
    )
    db_session.add(horario)
    db_session.commit()

    resp = client.get("/api/v1/asistencias/horarios")
    assert resp.status_code == 200
    encontrado = next(h for h in resp.json() if h["id"] == horario.id)
    assert encontrado["nivelRankingId"] == nivel.id


def test_crear_horario_ignora_nivel_ranking_id_en_el_request(client, db_session):
    """Regresión de contrato: HorarioCreateDTO no acepta nivel_ranking_id.
    Enviarlo en el body no debe cambiar el shape aceptado ni persistirlo --
    el campo permanece null en la respuesta."""
    entrenador = _crear_persona_api(client, "1710034065", "Carlos")
    _convertir_en_entrenador(db_session, entrenador["id"])

    nivel = NivelRanking(numero_nivel=2, nombre="Intermedio")
    db_session.add(nivel)
    db_session.commit()

    resp = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "dia_semana": "LUNES", "hora_inicio": "18:00:00", "hora_fin": "19:00:00",
            "entrenador_id": entrenador["id"], "nivel_ranking_id": nivel.id,
        },
    )
    assert resp.status_code == 201
    assert resp.json()["nivelRankingId"] is None
