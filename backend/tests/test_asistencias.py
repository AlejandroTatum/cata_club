from app.dominio.modelos import Persona, Usuario, Rol
from app.dominio.enums import TipoRol
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.persona_servicio import _calcular_edad
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
            "categoria": "JUVENIL", "dia_semana": "LUNES",
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
            "categoria": "JUVENIL", "dia_semana": "LUNES",
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
            "categoria": "JUVENIL", "dia_semana": "LUNES",
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


def test_registrar_asistencia_dos_veces_actualiza_en_vez_de_duplicar(client, db_session):
    """Bug confirmado: reabrir el wizard de "Tomar asistencia" de una sesión
    ya registrada y volver a enviar no debe crear filas duplicadas -- debe
    actualizar el registro existente para la misma (persona_id, horario_id,
    fecha_entrenamiento)."""
    entrenador = _crear_persona_api(client, "1710034065", "Carlos")
    _convertir_en_entrenador(db_session, entrenador["id"])
    alumno = _crear_persona_api(client, "1710034073", "Ana")

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "categoria": "JUVENIL", "dia_semana": "LUNES",
            "entrenador_id": entrenador["id"],
        },
    ).json()

    payload_base = {
        "fecha_entrenamiento": str(date(2026, 7, 13)),
        "persona_id": alumno["id"], "entrenador_id": entrenador["id"],
        "horario_id": horario["id"],
    }

    primera = client.post(
        "/api/v1/asistencias/",
        json={**payload_base, "estado": "PRESENTE"},
    )
    assert primera.status_code == 201

    segunda = client.post(
        "/api/v1/asistencias/",
        json={**payload_base, "estado": "AUSENTE"},
    )
    assert segunda.status_code == 201
    assert segunda.json()["id"] == primera.json()["id"]

    reporte = client.get(
        f"/api/v1/asistencias/reportes?horario_id={horario['id']}"
    ).json()
    registros_alumno = [r for r in reporte if r["personaId"] == alumno["id"]]
    assert len(registros_alumno) == 1
    assert registros_alumno[0]["estado"] == "AUSENTE"


def test_listar_alumnos_por_horario_incluye_edad_calculada(client, db_session):
    """`AlumnoHorarioDetalleDTO.edad` debe salir calculada a partir de
    `Persona.fecha_nacimiento` vía `_calcular_edad`, no hardcodeada ni
    ausente -- roster del frontend la necesita para mostrarla junto al
    nombre del alumno."""
    entrenador = _crear_persona_api(client, "1710034065", "Carlos")
    _convertir_en_entrenador(db_session, entrenador["id"])
    alumno = _crear_persona_api(client, "1710034073", "Ana")

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "categoria": "JUVENIL", "dia_semana": "LUNES",
            "entrenador_id": entrenador["id"],
        },
    ).json()

    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    resp = client.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    edad_esperada = _calcular_edad(date(2010, 5, 14))
    assert body[0]["edad"] == edad_esperada
