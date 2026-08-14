from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona
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


# --- Issue #13: sin relación entrenador–horario -----------------------------
# El club no asigna entrenadores a horarios: la clase la da quien está
# disponible (docs/product/concepto-alcance-modelo.md §4). El horario se crea solo con
# categoría y día, y la asistencia no registra quién dictó la sesión.
def test_crear_horario_sin_entrenador(client):
    resp = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    )
    assert resp.status_code == 201
    assert resp.json()["diaSemana"] == "LUNES"
    assert "entrenadorId" not in resp.json()


def test_cualquier_entrenador_registra_asistencia_en_cualquier_horario(
    client_entrenador, client,
):
    """Permisos simplificados (issue #13): un ENTRENADOR sin ninguna relación
    previa con el horario puede tomar asistencia en él. Antes el payload
    exigía un `entrenador_id` validado contra el rol; hoy alcanza con el rol
    de quien llama -- la asistencia no registra quién dictó la clase."""
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    _restaurar_token_entrenador()
    resp = client_entrenador.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 201
    assert "entrenadorId" not in resp.json()


def test_registrar_asistencia_dos_veces_actualiza_en_vez_de_duplicar(client):
    """Bug confirmado: reabrir el wizard "Tomar asistencia" para una sesión
    ya registrada y volver a enviar creaba filas duplicadas en vez de
    actualizar las existentes. `registrar_asistencia` debe hacer upsert por
    (persona_id, horario_id, fecha_entrenamiento): exactamente una fila por
    esa combinación, con el último `estado` enviado."""
    alumno = _crear_persona_api(client, "1710034073", "Ana")

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    payload = {
        "fecha_entrenamiento": str(date(2026, 7, 20)), "estado": "PRESENTE",
        "persona_id": alumno["id"], "horario_id": horario["id"],
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
        r for r in historial.json()["items"]
        if r["horarioId"] == horario["id"] and r["fechaEntrenamiento"] == str(date(2026, 7, 20))
    ]
    assert len(registros) == 1
    assert registros[0]["estado"] == "AUSENTE"


def test_listar_alumnos_por_horario_incluye_edad_calculada(client):
    """`AlumnoHorarioDetalleDTO.edad` debe salir calculada a partir de
    `Persona.fecha_nacimiento` vía `_calcular_edad`, no hardcodeada ni
    ausente -- roster del frontend la necesita para mostrarla junto al
    nombre del alumno."""
    alumno = _crear_persona_api(client, "1710034073", "Ana")

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()

    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    resp = client.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")
    assert resp.status_code == 200
    # Paginado (issue #7): el roster viaja en el envelope `{items, total, ...}`.
    body = resp.json()["items"]
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


def _restaurar_token_entrenador():
    """Misma convención que `_restaurar_token_alumno`, pero con un token de
    ENTRENADOR puro (sin ADMINISTRADOR): pedir `client_entrenador` antes que
    `client` en la firma, montar los datos con `client` y restaurar este
    token justo antes de la llamada que se quiere probar como entrenador."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "entrenador@cataclub.test", "persona_id": 1, "roles": ["ENTRENADOR"],
    }


# --- SEC-1: roster IDOR -------------------------------------------------
# `GET /asistencias/horarios/{id}/alumnos` solo exigia un token valido (via
# `GestorAutenticacion.decodificar_token`), sin rol ni ownership -- cualquier
# sesion autenticada (alumno, representante) podia enumerar nombre, edad y
# persona_id de cada alumno inscrito en cualquier horario del club, solo
# incrementando el id. El fix exige ADMINISTRADOR/ENTRENADOR sin excepcion,
# igual que `desasignar_alumno_de_horario` (linea 170).
def test_listar_alumnos_por_horario_rechaza_alumno_sin_relacion(client_sin_permisos, client):
    """Un ALUMNO sin ninguna relacion con el horario debe recibir 403."""
    otro_alumno = _crear_persona_api(client, "1710034073", "Ana")

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": otro_alumno["id"], "horario_id": horario["id"]},
    )

    _restaurar_token_alumno()
    resp = client_sin_permisos.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")
    assert resp.status_code == 403


# --- LIFE-1: precondición de inscripción --------------------------------
# `registrar_asistencia` validaba persona y horario, pero nunca la
# inscripción (`AlumnoHorario`): `POST /asistencias/` podía crear
# asistencia para un alumno jamás asignado a ese horario. El único camino
# real de alta es `POST /asistencias/asignar-alumno`.
def test_registrar_asistencia_rechaza_sin_alumno_horario_insercion(client):
    """Sin inscripción previa (ni asistencia previa): el alta debe
    rechazarse y no debe quedar ninguna fila creada."""
    alumno = _crear_persona_api(client, "1710034073", "Ana")

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    # Deliberadamente NO se llama a /asistencias/asignar-alumno.

    resp = client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 400
    # El mensaje identifica al alumno por su NOMBRE, no por su id: el id era
    # inútil para quien lee la pantalla y ahora viaja al log, en
    # `detalle_tecnico`.
    assert "Ana Torres" in resp.json()["detail"]

    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    assert historial.json()["items"] == []


def test_registrar_asistencia_rechaza_sin_alumno_horario_actualizacion(client):
    """El upsert cubre altas Y actualizaciones: si la inscripción se retira
    después de que ya existe una Asistencia (`desasignar_alumno_de_horario`),
    reabrir el wizard y reenviar la misma combinación debe rechazarse igual
    que el alta -- de lo contrario la rama de actualización sería un bypass
    de la regla que la rama de creación sí aplica. La fila existente no debe
    modificarse."""
    alumno = _crear_persona_api(client, "1710034073", "Ana")

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    payload = {
        "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
        "persona_id": alumno["id"], "horario_id": horario["id"],
    }
    primera = client.post("/api/v1/asistencias/", json=payload)
    assert primera.status_code == 201

    client.request(
        "DELETE", "/api/v1/asistencias/desasignar-alumno",
        params={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    segunda = client.post("/api/v1/asistencias/", json={**payload, "estado": "AUSENTE"})
    assert segunda.status_code == 400
    assert "Ana Torres" in segunda.json()["detail"]

    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    registros = [r for r in historial.json()["items"] if r["horarioId"] == horario["id"]]
    assert len(registros) == 1
    assert registros[0]["estado"] == "PRESENTE"  # sin cambios


def test_listar_alumnos_por_horario_rechaza_aunque_el_propio_este_inscrito(
    client_sin_permisos, client,
):
    """Sin carve-out de ownership: el DTO devuelve el roster COMPLETO del
    horario (compañeros incluidos), asi que estar inscrito ahi tampoco
    habilita a un ALUMNO a leerlo -- para eso existe el endpoint dedicado
    `GET /asistencias/alumnos/{persona_id}/horarios` (ownership-gated,
    sin cambios por este fix)."""
    alumno = _crear_persona_api(client, cedula_valida(140))  # relleno -> id=1
    assert alumno["id"] == 1  # coincide con persona_id del token de client_sin_permisos

    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    _restaurar_token_alumno()
    resp = client_sin_permisos.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")
    assert resp.status_code == 403


# --- TRA-7: roster de todos los horarios en una sola consulta ---------------
def test_roster_de_todos_los_horarios_junta_varios_horarios_en_una_consulta(client):
    """Un solo GET trae el roster de TODOS los horarios, agrupable por
    `horarioId` en el cliente -- reemplaza las 26 llamadas (una por horario)
    que /groups hacía antes para el conteo "N inscriptos"."""
    alumno_a = _crear_persona_api(client, cedula_valida(141), "Ana")
    alumno_b = _crear_persona_api(client, "1710034081", "Beto")

    horario_a = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    horario_b = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "FORMATIVO", "dia_semana": "MARTES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno_a["id"], "horario_id": horario_a["id"]},
    )
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno_b["id"], "horario_id": horario_b["id"]},
    )

    resp = client.get("/api/v1/asistencias/horarios/alumnos")

    assert resp.status_code == 200
    por_horario: dict[int, list[int]] = {}
    for fila in resp.json():
        por_horario.setdefault(fila["horarioId"], []).append(fila["personaId"])
    assert por_horario[horario_a["id"]] == [alumno_a["id"]]
    assert por_horario[horario_b["id"]] == [alumno_b["id"]]


def test_roster_de_todos_los_horarios_excluye_a_los_dados_de_baja(client, db_session):
    """Mismo filtro de baja lógica que `listar_por_horario`: alguien que ya
    no está en el club no puede figurar en ningún roster."""
    alumno = _crear_persona_api(client, cedula_valida(142), "Cami")
    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    persona = db_session.get(Persona, alumno["id"])
    persona.activo = False
    db_session.commit()

    resp = client.get("/api/v1/asistencias/horarios/alumnos")

    assert resp.status_code == 200
    assert alumno["id"] not in [fila["personaId"] for fila in resp.json()]


def test_roster_de_todos_los_horarios_requiere_admin_o_entrenador(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/asistencias/horarios/alumnos")
    assert resp.status_code == 403


# --- Fix 8 / DSH-2: "últimas listas del club" -------------------------------
# El panel del entrenador rediseñado (§8 de decisiones-de-negocio-2026-08-11.md)
# muestra las últimas listas tomadas en el club, sin autor: no existe relación
# entrenador-horario (issue #13) y `Asistencia` no guarda quién tomó la lista
# (modelos.py:536, deliberado). El candado de este fix: sin el endpoint, la
# ruta ni existe (404); con él, agrupa por (horario, fecha) y cuenta los
# cuatro estados.
def _crear_horario_api(client, dia="LUNES", categoria="JUVENIL"):
    resp = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": categoria, "dia_semana": dia},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _registrar_lista(client, persona_id, horario_id, fecha, estado):
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": persona_id, "horario_id": horario_id},
    )
    resp = client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": fecha, "estado": estado,
            "persona_id": persona_id, "horario_id": horario_id,
        },
    )
    assert resp.status_code == 201, resp.text


def test_listar_ultimas_listas_cuenta_los_cuatro_estados(client):
    horario = _crear_horario_api(client)
    estudiantes = [
        _crear_persona_api(client, cedula_valida(8100 + i), f"Alumno{i}") for i in range(4)
    ]
    for persona, estado in zip(estudiantes, ["PRESENTE", "ATRASADO", "JUSTIFICADO", "AUSENTE"]):
        _registrar_lista(client, persona["id"], horario["id"], "2026-08-03", estado)

    resp = client.get("/api/v1/asistencias/ultimas-listas")
    assert resp.status_code == 200
    listas = resp.json()
    assert len(listas) == 1
    lista = listas[0]
    assert lista["horarioId"] == horario["id"]
    assert lista["fechaEntrenamiento"] == "2026-08-03"
    assert lista["presentes"] == 1
    assert lista["tardanzas"] == 1
    assert lista["justificados"] == 1
    assert lista["ausentes"] == 1
    assert lista["total"] == 4


def test_listar_ultimas_listas_ordena_las_mas_recientes_primero(client):
    horario = _crear_horario_api(client)
    alumno = _crear_persona_api(client, cedula_valida(143), "Ana")
    _registrar_lista(client, alumno["id"], horario["id"], "2026-07-06", "PRESENTE")
    _registrar_lista(client, alumno["id"], horario["id"], "2026-08-03", "PRESENTE")

    resp = client.get("/api/v1/asistencias/ultimas-listas")
    fechas = [lista["fechaEntrenamiento"] for lista in resp.json()]
    assert fechas == ["2026-08-03", "2026-07-06"]


def test_listar_ultimas_listas_no_expone_autor(client):
    """Candado del recorte de alcance: la lista no dice quién la tomó."""
    horario = _crear_horario_api(client)
    alumno = _crear_persona_api(client, cedula_valida(144), "Ana")
    _registrar_lista(client, alumno["id"], horario["id"], "2026-08-03", "PRESENTE")

    resp = client.get("/api/v1/asistencias/ultimas-listas")
    lista = resp.json()[0]
    assert "entrenadorId" not in lista
    assert "registradoPor" not in lista
    assert "personaId" not in lista


def test_listar_ultimas_listas_entrenador_puede_acceder(client_entrenador, client):
    horario = _crear_horario_api(client)
    alumno = _crear_persona_api(client, cedula_valida(145), "Ana")
    _registrar_lista(client, alumno["id"], horario["id"], "2026-08-03", "PRESENTE")

    _restaurar_token_entrenador()
    resp = client_entrenador.get("/api/v1/asistencias/ultimas-listas")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_listar_ultimas_listas_rechaza_rol_sin_permiso(client_sin_permisos, client):
    _restaurar_token_alumno()
    resp = client_sin_permisos.get("/api/v1/asistencias/ultimas-listas")
    assert resp.status_code == 403
