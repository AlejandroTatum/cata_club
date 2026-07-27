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
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

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
    """Bug confirmado: reabrir el wizard "Tomar asistencia" para una sesión
    ya registrada y volver a enviar creaba filas duplicadas en vez de
    actualizar las existentes. `registrar_asistencia` debe hacer upsert por
    (persona_id, horario_id, fecha_entrenamiento): exactamente una fila por
    esa combinación, con el último `estado` enviado."""
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

    payload = {
        "fecha_entrenamiento": str(date(2026, 7, 20)), "estado": "PRESENTE",
        "persona_id": alumno["id"], "entrenador_id": entrenador["id"],
        "horario_id": horario["id"],
    }
    primera = client.post("/api/v1/asistencias/", json=payload)
    assert primera.status_code == 201

    segunda = client.post(
        "/api/v1/asistencias/",
        json={**payload, "estado": "AUSENTE"},
    )
    assert segunda.status_code == 201
    assert segunda.json()["id"] == primera.json()["id"]
    assert segunda.json()["estado"] == "AUSENTE"

    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    registros = [
        r for r in historial.json()
        if r["horarioId"] == horario["id"] and r["fechaEntrenamiento"] == str(date(2026, 7, 20))
    ]
    assert len(registros) == 1
    assert registros[0]["estado"] == "AUSENTE"


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


# --- SEC-1: roster IDOR -------------------------------------------------
# `GET /asistencias/horarios/{id}/alumnos` solo exigia un token valido (via
# `GestorAutenticacion.decodificar_token`), sin rol ni ownership -- cualquier
# sesion autenticada (alumno, representante) podia enumerar nombre, edad y
# persona_id de cada alumno inscrito en cualquier horario del club, solo
# incrementando el id. El fix exige ADMINISTRADOR/ENTRENADOR sin excepcion,
# igual que `desasignar_alumno_de_horario` (linea 170).
def _restaurar_token_alumno():
    """`client_sin_permisos` y `client` comparten el mismo `app` singleton,
    así que pedir ambas fixtures en un test dispara `app.dependency_overrides
    .clear()` del último inicializado. Convención ya usada en
    `test_voucher_pago.py::test_subir_voucher_sin_ser_duenio_ni_admin_da_403`:
    pedir `client_sin_permisos` antes que `client` en la firma, montar los
    datos con `client` (admin), y restaurar manualmente el token de ALUMNO
    justo antes de la llamada que se quiere probar sin permisos."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": 1, "roles": ["ALUMNO"],
    }


# --- SEC-1: roster IDOR -------------------------------------------------
# `GET /asistencias/horarios/{id}/alumnos` solo exigia un token valido (via
# `GestorAutenticacion.decodificar_token`), sin rol ni ownership -- cualquier
# sesion autenticada (alumno, representante) podia enumerar nombre, edad y
# persona_id de cada alumno inscrito en cualquier horario del club, solo
# incrementando el id. El fix exige ADMINISTRADOR/ENTRENADOR sin excepcion,
# igual que `desasignar_alumno_de_horario` (linea 170).
def test_listar_alumnos_por_horario_rechaza_alumno_sin_relacion(client_sin_permisos, client, db_session):
    """Un ALUMNO sin ninguna relacion con el horario debe recibir 403."""
    entrenador = _crear_persona_api(client, "1710034065", "Carlos")
    _convertir_en_entrenador(db_session, entrenador["id"])
    otro_alumno = _crear_persona_api(client, "1710034073", "Ana")

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "categoria": "JUVENIL", "dia_semana": "LUNES",
            "entrenador_id": entrenador["id"],
        },
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": otro_alumno["id"], "horario_id": horario["id"]},
    )

    _restaurar_token_alumno()
    resp = client_sin_permisos.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")
    assert resp.status_code == 403


# --- LIFE-1: precondición de inscripción --------------------------------
# `registrar_asistencia` validaba persona, horario y entrenador, pero nunca
# la inscripción (`AlumnoHorario`): `POST /asistencias/` podía crear
# asistencia para un alumno jamás asignado a ese horario. El único camino
# real de alta es `POST /asistencias/asignar-alumno`.
def test_registrar_asistencia_rechaza_sin_alumno_horario_insercion(client, db_session):
    """Sin inscripción previa (ni asistencia previa): el alta debe
    rechazarse y no debe quedar ninguna fila creada."""
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
    # Deliberadamente NO se llama a /asistencias/asignar-alumno.

    resp = client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
            "persona_id": alumno["id"], "entrenador_id": entrenador["id"],
            "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 400
    assert str(alumno["id"]) in resp.json()["detail"]

    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    assert historial.json() == []


def test_registrar_asistencia_rechaza_sin_alumno_horario_actualizacion(client, db_session):
    """El upsert cubre altas Y actualizaciones: si la inscripción se retira
    después de que ya existe una Asistencia (`desasignar_alumno_de_horario`),
    reabrir el wizard y reenviar la misma combinación debe rechazarse igual
    que el alta -- de lo contrario la rama de actualización sería un bypass
    de la regla que la rama de creación sí aplica. La fila existente no debe
    modificarse."""
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

    payload = {
        "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
        "persona_id": alumno["id"], "entrenador_id": entrenador["id"],
        "horario_id": horario["id"],
    }
    primera = client.post("/api/v1/asistencias/", json=payload)
    assert primera.status_code == 201

    client.request(
        "DELETE", "/api/v1/asistencias/desasignar-alumno",
        params={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    segunda = client.post("/api/v1/asistencias/", json={**payload, "estado": "AUSENTE"})
    assert segunda.status_code == 400
    assert str(alumno["id"]) in segunda.json()["detail"]

    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    registros = [r for r in historial.json() if r["horarioId"] == horario["id"]]
    assert len(registros) == 1
    assert registros[0]["estado"] == "PRESENTE"  # sin cambios


def test_listar_alumnos_por_horario_rechaza_aunque_el_propio_este_inscrito(
    client_sin_permisos, client, db_session,
):
    """Sin carve-out de ownership: el DTO devuelve el roster COMPLETO del
    horario (compañeros incluidos), asi que estar inscrito ahi tampoco
    habilita a un ALUMNO a leerlo -- para eso existe el endpoint dedicado
    `GET /asistencias/alumnos/{persona_id}/horarios` (ownership-gated,
    sin cambios por este fix)."""
    alumno = _crear_persona_api(client, "0000000001")  # relleno -> id=1
    assert alumno["id"] == 1  # coincide con persona_id del token de client_sin_permisos
    entrenador = _crear_persona_api(client, "1710034073", "Carlos")
    _convertir_en_entrenador(db_session, entrenador["id"])

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

    _restaurar_token_alumno()
    resp = client_sin_permisos.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")
    assert resp.status_code == 403
