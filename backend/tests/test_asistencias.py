from app.dominio.cedula import cedula_valida
from app.dominio.modelos import AsistenciaCorreccion, Persona
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.persona_servicio import _calcular_edad
from datetime import date, timedelta

_DIA_SEMANA_DE_WEEKDAY = [
    "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO",
]


def _dia_semana_de(fecha: str) -> str:
    """El `dia_semana` (mayúsculas, como lo espera la API) del `weekday()` real
    de `fecha` (`YYYY-MM-DD`). Issue #308: el servicio ahora exige que
    `fecha_entrenamiento` caiga en el `dia_semana` del horario, así que un
    test que arma su propio horario para una fecha arbitraria tiene que
    crearlo en el día que esa fecha realmente es -- de lo contrario el `POST`
    que el test da por válido se rechaza con 400 antes de llegar a lo que el
    test en verdad ejercita."""
    anio, mes, dia = map(int, fecha.split("-"))
    return _DIA_SEMANA_DE_WEEKDAY[date(anio, mes, dia).weekday()]


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


def test_registrar_asistencia_dos_veces_se_rechaza_por_sesion_cerrada(client):
    """Issue #389: reabrir el wizard "Tomar asistencia" para una sesión ya
    registrada y volver a enviar YA NO actualiza la fila existente -- el
    primer registro exitoso cierra la sesión de forma permanente, así que
    el segundo envío se rechaza con 400 y la fila original queda intacta
    (reemplaza el upsert previo, que sí actualizaba en el lugar)."""
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
    assert segunda.status_code == 400
    assert "cerrada" in segunda.json()["detail"].lower()

    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    registros = [
        r for r in historial.json()["items"]
        if r["horarioId"] == horario["id"] and r["fechaEntrenamiento"] == str(date(2026, 7, 20))
    ]
    assert len(registros) == 1
    assert registros[0]["estado"] == "PRESENTE"  # sin cambios: no se pisó


# --- Issue #308: la fecha registrada tiene que ser la del horario ----------
# Candado de test del issue: pasar lista de un horario de Miércoles con la
# fecha de un Domingo debe rechazarse -- exactamente la reproducción del
# hallazgo #4 (auditoría 2026-08-16), donde el cliente mandaba `hoy` en vez
# del día real del horario elegido y el backend lo aceptaba con 201.
def test_registrar_asistencia_rechaza_fecha_que_no_coincide_con_el_dia_del_horario(client):
    """`fecha_entrenamiento` debe caer en el `dia_semana` real del horario.
    Sin esta invariante en el backend, el arreglo del frontend (issue #308)
    dependía por completo de que el cliente se portara bien -- la API seguía
    abierta a que cualquier llamador mandara cualquier fecha con cualquier
    horario."""
    alumno = _crear_persona_api(client, "1710034073", "Ana")
    horario = _crear_horario_api(client, dia="MIERCOLES")
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    resp = client.post(
        "/api/v1/asistencias/",
        json={
            # 2026-08-16 es domingo; el horario es de miércoles.
            "fecha_entrenamiento": "2026-08-16", "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 400
    detalle = resp.json()["detail"].lower()
    assert "domingo" in detalle
    assert "miércoles" in detalle

    # Nada quedó creado: el rechazo es total, no una fila corrupta más.
    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    assert historial.json()["items"] == []


def test_registrar_asistencia_acepta_fecha_que_coincide_con_el_dia_del_horario(client):
    """Contracara del candado de arriba: la MISMA fecha, para un horario del
    día que realmente es, se acepta -- el candado rechaza el par
    (fecha, horario) equivocado, no la fecha en sí."""
    alumno = _crear_persona_api(client, cedula_valida(9001), "Bea")
    horario = _crear_horario_api(client, dia="MIERCOLES")
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    resp = client.post(
        "/api/v1/asistencias/",
        json={
            # 2026-08-19 es miércoles -- coincide con el horario.
            "fecha_entrenamiento": "2026-08-19", "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 201, resp.text


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


# --- Issue #356: el recorte de permisos del entrenador (representados,
# antecedentes-club) no le toca nada a su tarea diaria -- pasar lista. Este
# candado prueba el roster con un token de ENTRENADOR PURO (sin
# ADMINISTRADOR, a diferencia del fixture `client` combinado de arriba).
def test_roster_de_todos_los_horarios_funciona_con_token_de_entrenador_puro(client_entrenador, client):
    alumno = _crear_persona_api(client, cedula_valida(143), "Dani")
    horario = _crear_horario_api(client)
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    _restaurar_token_entrenador()
    resp = client_entrenador.get("/api/v1/asistencias/horarios/alumnos")
    assert resp.status_code == 200
    assert alumno["id"] in [fila["personaId"] for fila in resp.json()]


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


# --- Issue #389: cierre permanente de sesión (reemplaza la corrección de
# issue #262) -----------------------------------------------------------------
# El mecanismo previo (solo ADMINISTRADOR corrige, tope de 30 días) queda
# eliminado: re-registrar a quien YA tiene fila se rechaza con 400 para
# cualquier rol, sin importar la antigüedad. La toma original no tiene tope.
_HOY_CORRECCION = date(2026, 8, 15)


def _congelar_hoy_asistencia(monkeypatch, hoy):
    """Fija el `hoy_club()` del servicio de asistencia para que la antigüedad
    no dependa del reloj real del equipo que corre la suite."""
    import app.servicios_negocio.asistencia_servicio as asistencia_mod
    monkeypatch.setattr(asistencia_mod, "hoy_club", lambda: hoy)


def _preparar_asistencia_para_corregir(client, fecha):
    """Crea persona + horario + inscripción + una asistencia inicial (como
    ADMINISTRADOR) y devuelve el payload de esa asistencia.

    El horario se crea en el día real de `fecha` (issue #308): estos tests
    combinan `fecha` con deltas de antigüedad, no con un día de semana en
    particular, así que el horario tiene que seguir a la fecha -- nunca al
    revés. Sábado necesita COMPETITIVO (la única categoría de la siembra que
    lo permite); el resto usa JUVENIL (Lunes-Viernes), como el resto del
    archivo. Ninguna fecha usada acá cae en Domingo, que ninguna categoría
    permite."""
    dia = _dia_semana_de(fecha)
    categoria = "COMPETITIVO" if dia == "SABADO" else "JUVENIL"
    alumno = _crear_persona_api(client)
    horario = _crear_horario_api(client, dia=dia, categoria=categoria)
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )
    payload = {
        "fecha_entrenamiento": fecha, "estado": "PRESENTE",
        "persona_id": alumno["id"], "horario_id": horario["id"],
    }
    primera = client.post("/api/v1/asistencias/", json=payload)
    assert primera.status_code == 201, primera.text
    return payload


def test_entrenador_no_puede_corregir_asistencia_existente(client_entrenador, client, monkeypatch):
    """Issue #389: re-enviar un registro ya existente se rechaza para
    CUALQUIER rol -- el ENTRENADOR ya no recibe el 403 de "falta de rol"
    (ese chequeo no existe más en esta rama): recibe el mismo 400 de sesión
    cerrada que recibiría un administrador."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    payload = _preparar_asistencia_para_corregir(
        client, str(_HOY_CORRECCION - timedelta(days=5))
    )

    _restaurar_token_entrenador()
    resp = client_entrenador.post(
        "/api/v1/asistencias/", json={**payload, "estado": "AUSENTE"},
    )
    assert resp.status_code == 400
    assert "cerrada" in resp.json()["detail"].lower()


def test_admin_no_puede_reabrir_sesion_cerrada_sin_importar_antiguedad(client, monkeypatch):
    """Issue #389: el tope de 30 días del #262 queda eliminado -- un
    ADMINISTRADOR ya NUNCA re-registra a quien ya tiene fila, sin importar
    la antigüedad (antes, el día 30 devolvía 201). Cada iteración usa su
    propio alumno/horario en un weekday distinto (sin domingo) para no
    chocar con `uq_horario_categoria_dia` ni con la cédula anterior."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    for indice, antiguedad_dias in enumerate((0, 5, 30, 31, 60)):
        fecha = str(_HOY_CORRECCION - timedelta(days=antiguedad_dias))
        dia = _dia_semana_de(fecha)
        categoria = "COMPETITIVO" if dia == "SABADO" else "JUVENIL"
        alumno = _crear_persona_api(client, cedula_valida(170 + indice), f"Alumno{indice}")
        horario = _crear_horario_api(client, dia=dia, categoria=categoria)
        client.post(
            "/api/v1/asistencias/asignar-alumno",
            json={"persona_id": alumno["id"], "horario_id": horario["id"]},
        )
        payload = {
            "fecha_entrenamiento": fecha, "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        }
        primera = client.post("/api/v1/asistencias/", json=payload)
        assert primera.status_code == 201, primera.text

        resp = client.post("/api/v1/asistencias/", json={**payload, "estado": "AUSENTE"})
        assert resp.status_code == 400, (antiguedad_dias, resp.text)
        assert "cerrada" in resp.json()["detail"].lower()


def test_toma_original_por_entrenador_no_tiene_tope_de_antiguedad(client_entrenador, client, monkeypatch):
    """La toma ORIGINAL (crear el primer registro) sigue siendo del ENTRENADOR
    y no hereda el tope de 30 días: crear un registro antiguo no se rechaza."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    fecha = str(_HOY_CORRECCION - timedelta(days=45))
    alumno = _crear_persona_api(client)
    # El horario sigue a `fecha` (issue #308), no al default LUNES.
    horario = _crear_horario_api(client, dia=_dia_semana_de(fecha))
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    _restaurar_token_entrenador()
    resp = client_entrenador.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": fecha,
            "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 201


def test_re_tomar_mismo_dia_por_entrenador_se_rechaza_como_correccion(client_entrenador, client, monkeypatch):
    """Re-tomar el MISMO día sigue cayendo en la rama de re-registro: un
    ENTRENADOR que reenvía la lista del día recibe el mismo 400 de sesión
    cerrada (issue #389 -- ya no es un 403 de rol, porque el rol dejó de
    importar en esta rama)."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    payload = _preparar_asistencia_para_corregir(client, str(_HOY_CORRECCION))

    _restaurar_token_entrenador()
    resp = client_entrenador.post(
        "/api/v1/asistencias/", json={**payload, "estado": "AUSENTE"},
    )
    assert resp.status_code == 400
    assert "cerrada" in resp.json()["detail"].lower()


def test_segundo_alumno_se_registra_en_sesion_ya_cerrada(client):
    """El cierre bloquea RE-registrar a quien ya tiene fila, no altas
    nuevas en la misma sesión (issue #389): un segundo alumno sin fila debe
    poder registrarse aunque la sesión ya esté cerrada -- si no, un lote
    parcialmente fallido (issue #352) no podría reintentarse."""
    alumno_a = _crear_persona_api(client, cedula_valida(180), "Ana")
    alumno_b = _crear_persona_api(client, cedula_valida(181), "Beto")
    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    for alumno in (alumno_a, alumno_b):
        client.post(
            "/api/v1/asistencias/asignar-alumno",
            json={"persona_id": alumno["id"], "horario_id": horario["id"]},
        )

    payload_base = {
        "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
        "horario_id": horario["id"],
    }
    primera = client.post(
        "/api/v1/asistencias/", json={**payload_base, "persona_id": alumno_a["id"]},
    )
    assert primera.status_code == 201  # cierra la sesión

    segunda = client.post(
        "/api/v1/asistencias/", json={**payload_base, "persona_id": alumno_b["id"]},
    )
    assert segunda.status_code == 201  # alta nueva, no re-registro


# --- Issue #263: persistir quién tomó la lista ---------------------------------
# La identidad viene del TOKEN (`persona_id`), nunca del DTO. Solo se setea en la
# rama de CREACIÓN; la corrección (#262) no la pisa. Las filas históricas quedan
# con `registrado_por_id = NULL` (sin backfill falso) y se exponen como tal.


def _crear_autor_y_alumno(client, dia="LUNES"):
    """Primera persona creada (id=1) es el AUTOR (el token admin es
    `persona_id=1`); la segunda (id=2) es el alumno al que se le toma lista.
    Devuelve (autor, alumno, horario). `dia` default LUNES para los llamados
    que registran en 2026-07-13 (un lunes); un llamado con otra fecha debe
    pasar el día real (issue #308)."""
    autor = _crear_persona_api(client, cedula_valida(146), "María")
    alumno = _crear_persona_api(client, cedula_valida(147), "Ana")
    assert autor["id"] == 1
    horario = _crear_horario_api(client, dia=dia)
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )
    return autor, alumno, horario


def test_registrar_asistencia_persiste_quien_tomo_la_lista(client):
    """La creación graba `registrado_por_id` con la persona del token y el DTO
    de respuesta expone `registrado_por_nombre` resuelto (join a Persona)."""
    autor, alumno, horario = _crear_autor_y_alumno(client)

    resp = client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 201
    assert resp.json()["registradoPorId"] == autor["id"]
    assert resp.json()["registradoPorNombre"] == "María Torres"


def test_registrar_asistencia_ignora_autor_enviado_en_el_body(client):
    """La identidad sale del token, nunca del DTO: un `registrado_por_id`
    forjado en el body se ignora (AsistenciaCreateDTO no tiene campos de
    identidad) y se graba la persona del token."""
    autor, alumno, horario = _crear_autor_y_alumno(client)

    resp = client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
            "registrado_por_id": 999,  # forjado: debe descartarse
        },
    )
    assert resp.status_code == 201
    assert resp.json()["registradoPorId"] == autor["id"]
    assert resp.json()["registradoPorNombre"] == "María Torres"


# --- Issue #389, slice 2: corrección transaccional --------------------------
# `PATCH /asistencias/{id}/corregir`, el reemplazo explícito del mecanismo
# de "corrección" que el slice 1 eliminó de `registrar_asistencia`. Solo
# ADMINISTRADOR, con motivo obligatorio y traza append-only.
def _id_de_la_asistencia(client, persona_id):
    """El id de la (única) fila de Asistencia de esta persona, vía el
    historial -- `_preparar_asistencia_para_corregir` devuelve el payload
    del POST, no la respuesta, así que el id se recupera por acá."""
    historial = client.get(f"/api/v1/asistencias/persona/{persona_id}")
    return historial.json()["items"][0]["id"]


def test_admin_corrige_asistencia_dentro_de_la_ventana(client, monkeypatch):
    """Corrección feliz: la fila de Asistencia queda con el valor nuevo, la
    respuesta trae la traza completa de la corrección, y `registrado_por_id`
    (quién TOMÓ la lista originalmente) queda intacto -- corregir no
    reescribe la autoría de la toma."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    fecha = str(_HOY_CORRECCION - timedelta(days=5))
    payload = _preparar_asistencia_para_corregir(client, fecha)
    asistencia_id = _id_de_la_asistencia(client, payload["persona_id"])

    resp = client.patch(
        f"/api/v1/asistencias/{asistencia_id}/corregir",
        json={"estado": "AUSENTE", "motivo": "El alumno no asistió, se cargó mal."},
    )
    assert resp.status_code == 200, resp.text
    cuerpo = resp.json()
    assert cuerpo["asistencia"]["estado"] == "AUSENTE"
    assert cuerpo["asistencia"]["registradoPorId"] == 1
    assert cuerpo["estadoAnterior"] == "PRESENTE"
    assert cuerpo["motivo"] == "El alumno no asistió, se cargó mal."
    assert cuerpo["corregidoPorId"] == 1
    assert cuerpo["corregidoPorNombre"]
    assert cuerpo["corregidoEn"]


def test_entrenador_no_puede_corregir_asistencia(client_entrenador, client, monkeypatch):
    """Solo ADMINISTRADOR corrige -- ni siquiera el ENTRENADOR que tomó la
    lista originalmente."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    fecha = str(_HOY_CORRECCION - timedelta(days=5))
    payload = _preparar_asistencia_para_corregir(client, fecha)
    asistencia_id = _id_de_la_asistencia(client, payload["persona_id"])

    _restaurar_token_entrenador()
    resp = client_entrenador.patch(
        f"/api/v1/asistencias/{asistencia_id}/corregir",
        json={"estado": "AUSENTE", "motivo": "intento no autorizado"},
    )
    assert resp.status_code == 403


def test_admin_no_puede_corregir_mas_alla_de_la_ventana(client, monkeypatch):
    """`LIMITE_CORRECCION_ASISTENCIA_DIAS` = 30: el día 31 se rechaza."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    fecha = str(_HOY_CORRECCION - timedelta(days=31))
    payload = _preparar_asistencia_para_corregir(client, fecha)
    asistencia_id = _id_de_la_asistencia(client, payload["persona_id"])

    resp = client.patch(
        f"/api/v1/asistencias/{asistencia_id}/corregir",
        json={"estado": "AUSENTE", "motivo": "demasiado tarde"},
    )
    assert resp.status_code == 400


def test_admin_corrige_en_el_dia_30_permitido(client, monkeypatch):
    """Contracara del día 31: el límite es `> 30`, no `>= 30` -- el día 30
    exacto todavía cae dentro de la ventana permitida."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    fecha = str(_HOY_CORRECCION - timedelta(days=30))
    payload = _preparar_asistencia_para_corregir(client, fecha)
    asistencia_id = _id_de_la_asistencia(client, payload["persona_id"])

    resp = client.patch(
        f"/api/v1/asistencias/{asistencia_id}/corregir",
        json={"estado": "AUSENTE", "motivo": "todavía en ventana"},
    )
    assert resp.status_code == 200, resp.text


def test_corregir_asistencia_inexistente_da_404(client):
    resp = client.patch(
        "/api/v1/asistencias/999999/corregir",
        json={"estado": "AUSENTE", "motivo": "no existe"},
    )
    assert resp.status_code == 404


def test_corregir_asistencia_exige_motivo(client, monkeypatch):
    """`motivo` vacío se rechaza en validación Pydantic (422), antes de
    llegar al servicio."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    fecha = str(_HOY_CORRECCION - timedelta(days=5))
    payload = _preparar_asistencia_para_corregir(client, fecha)
    asistencia_id = _id_de_la_asistencia(client, payload["persona_id"])

    resp = client.patch(
        f"/api/v1/asistencias/{asistencia_id}/corregir",
        json={"estado": "AUSENTE", "motivo": ""},
    )
    assert resp.status_code == 422


def test_dos_correcciones_sucesivas_encadenan_estado_anterior_sin_pisarse(
    client, db_session, monkeypatch,
):
    """Dos correcciones sobre la MISMA fila dejan DOS filas de auditoría
    distintas (append-only, ninguna se pisa): la segunda corrección trae
    como `estado_anterior` el valor que dejó la primera, no el original."""
    _congelar_hoy_asistencia(monkeypatch, _HOY_CORRECCION)
    fecha = str(_HOY_CORRECCION - timedelta(days=5))
    payload = _preparar_asistencia_para_corregir(client, fecha)
    asistencia_id = _id_de_la_asistencia(client, payload["persona_id"])

    primera = client.patch(
        f"/api/v1/asistencias/{asistencia_id}/corregir",
        json={"estado": "AUSENTE", "motivo": "primera corrección"},
    )
    assert primera.status_code == 200, primera.text
    segunda = client.patch(
        f"/api/v1/asistencias/{asistencia_id}/corregir",
        json={"estado": "JUSTIFICADO", "motivo": "segunda corrección"},
    )
    assert segunda.status_code == 200, segunda.text

    assert primera.json()["estadoAnterior"] == "PRESENTE"
    assert segunda.json()["estadoAnterior"] == primera.json()["asistencia"]["estado"] == "AUSENTE"

    filas = db_session.query(AsistenciaCorreccion).filter_by(asistencia_id=asistencia_id).all()
    assert len(filas) == 2


def test_historial_expone_quien_tomo_la_lista(client):
    """El listado por persona (`GET /asistencias/persona/{id}`) devuelve los
    campos de autor en cada item."""
    autor, alumno, horario = _crear_autor_y_alumno(client)

    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )

    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    assert historial.status_code == 200
    items = historial.json()["items"]
    assert items[0]["registradoPorId"] == autor["id"]
    assert items[0]["registradoPorNombre"] == "María Torres"


def test_asistencia_historica_sin_autor_expone_null(client, db_session):
    """Fila previa a #263 (sin autor): `registrado_por_id` queda NULL (no hay
    backfill falso) y el historial lo expone como null."""
    from app.dominio.modelos import Asistencia
    from app.dominio.enums import EstadoAsistencia

    alumno = _crear_persona_api(client, cedula_valida(148), "Ana")
    horario = _crear_horario_api(client)
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumno["id"], "horario_id": horario["id"]},
    )

    # Fila "legacy": se inserta directamente sin `registrado_por_id`.
    db_session.add(Asistencia(
        fecha_entrenamiento=date(2026, 7, 6),
        estado=EstadoAsistencia.PRESENTE,
        persona_id=alumno["id"],
        horario_id=horario["id"],
    ))
    db_session.commit()

    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    assert historial.status_code == 200
    items = historial.json()["items"]
    assert items[0]["registradoPorId"] is None
    assert items[0]["registradoPorNombre"] is None


# --- Issue #358: el DTO lleva el nombre de la persona en origen ------------
# Reemplaza el rodeo por `GET /personas/{id}` que el BFF hacía SOLO para
# pintar el nombre en "revisar listas" (`fetchPersonaNameMap`,
# attendance-adapter.ts) -- ese endpoint exponía cédula/teléfono/fecha de
# nacimiento con ids secuenciales, y ahora vuelve a ser SOLO_ADMINISTRADOR.

def test_registrar_asistencia_expone_nombre_de_la_persona(client):
    """El DTO de creación expone `personaNombreCompleto` resuelto (join a
    Persona), mismo patrón que `registrado_por_nombre` (#263)."""
    autor, alumno, horario = _crear_autor_y_alumno(client)

    resp = client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )
    assert resp.status_code == 201
    assert resp.json()["personaNombreCompleto"] == "Ana Torres"


def test_historial_expone_nombre_de_la_persona(client):
    """El listado por persona (`GET /asistencias/persona/{id}`) también lleva
    el nombre en cada item, con el mismo criterio."""
    autor, alumno, horario = _crear_autor_y_alumno(client)

    client.post(
        "/api/v1/asistencias/",
        json={
            "fecha_entrenamiento": str(date(2026, 7, 13)), "estado": "PRESENTE",
            "persona_id": alumno["id"], "horario_id": horario["id"],
        },
    )

    historial = client.get(f"/api/v1/asistencias/persona/{alumno['id']}")
    assert historial.status_code == 200
    items = historial.json()["items"]
    assert items[0]["personaNombreCompleto"] == "Ana Torres"


def test_historial_no_agrega_n_mas_uno_al_exponer_el_nombre(client, db_session, contar_selects):
    """`listar_por_persona` ya hace joinedload de `persona` (asistencia_
    repositorio.py) para `registrado_por_nombre` -- este test fija que
    `persona_nombre_completo` reutiliza ese mismo eager-load y no dispara un
    SELECT extra por fila al crecer la cantidad de registros."""
    from app.infraestructura.repositorios.asistencia_repositorio import AsistenciaRepositorio

    autor, alumno, horario = _crear_autor_y_alumno(client)
    for fecha in ["2026-07-13", "2026-07-20", "2026-07-27"]:
        resp = client.post(
            "/api/v1/asistencias/",
            json={
                "fecha_entrenamiento": fecha, "estado": "PRESENTE",
                "persona_id": alumno["id"], "horario_id": horario["id"],
            },
        )
        assert resp.status_code == 201
    db_session.expire_all()  # fuerza recarga real desde la BD

    repo = AsistenciaRepositorio(db_session)
    with contar_selects() as sentencias:
        resultado = repo.listar_por_persona(alumno["id"])
        nombres = [a.persona_nombre_completo for a in resultado]

    assert len(resultado) == 3
    assert nombres == ["Ana Torres", "Ana Torres", "Ana Torres"]
    selects = [s for s in sentencias if s.strip().upper().startswith("SELECT")]
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT (persona ya joinedloaded), se ejecutaron {len(selects)}: {selects}"
    )
