"""
Tests del módulo de Ranking (E03). Usa las mismas fixtures `client` /
`client_sin_permisos` de conftest.py (persona_id=1 con roles
ADMINISTRADOR+ENTRENADOR combinados para `client`).

Nota: resultados mensuales, justificativos de ausencia, reingreso y
selección oficial (funcionalidad competitiva) fueron removidos por completo
del sistema. Lo que queda de este módulo es exclusivamente la asignación de
alumnos a niveles/grupos de entrenamiento -- ver docstring de
`ranking_servicio.py`.
"""


def _crear_persona(client, cedula):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Deportista", "apellidos": cedula, "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_nivel(client, numero_nivel, nombre="Nivel"):
    return client.post(
        "/api/v1/ranking/niveles", json={"numero_nivel": numero_nivel, "nombre": nombre}
    ).json()


def _asignar_nivel(client, persona_id, nivel_id):
    return client.post(
        "/api/v1/ranking/asignar-nivel-inicial",
        json={"persona_id": persona_id, "nivel_ranking_id": nivel_id},
    )


# --- Niveles de ranking (RF001) ----------------------------------------------
def test_crear_nivel_requiere_admin(client_sin_permisos):
    resp = client_sin_permisos.post(
        "/api/v1/ranking/niveles", json={"numero_nivel": 1, "nombre": "Elite"}
    )
    assert resp.status_code == 403


def test_crear_nivel_duplicado_falla(client):
    _crear_nivel(client, 1, "Elite")
    resp = client.post("/api/v1/ranking/niveles", json={"numero_nivel": 1, "nombre": "Otro"})
    assert resp.status_code == 400


def test_listar_niveles_marca_necesita_revision_bajo_minimo(client):
    _crear_nivel(client, 1, "Elite")
    resp = client.get("/api/v1/ranking/niveles")
    assert resp.status_code == 200
    assert resp.json()[0]["necesitaRevision"] is True  # 0 personas < mínimo 6


def test_asignar_nivel_bloquea_al_llegar_a_capacidad_maxima(client):
    nivel = _crear_nivel(client, 1, "Elite")
    for i in range(10):
        persona = _crear_persona(client, cedula=f"170000000{i}")
        resp = _asignar_nivel(client, persona["id"], nivel["id"])
        assert resp.status_code == 201

    persona_11 = _crear_persona(client, cedula="1799999999")
    resp = _asignar_nivel(client, persona_11["id"], nivel["id"])
    assert resp.status_code == 400
    assert "capacidad máxima" in resp.json()["detail"]


def test_asignar_nivel_inicial_requiere_entrenador(client_sin_permisos):
    resp = _asignar_nivel(client_sin_permisos, 999, 1)
    assert resp.status_code == 403


def test_no_se_puede_reasignar_nivel_ya_asignado_con_endpoint_de_asignacion(client):
    nivel = _crear_nivel(client, 1, "Elite")
    persona = _crear_persona(client, cedula="1711111111")
    _asignar_nivel(client, persona["id"], nivel["id"])
    resp = _asignar_nivel(client, persona["id"], nivel["id"])
    assert resp.status_code == 400


# --- Cierre mensual: superficie removida (spec "Removed endpoints return 404") ---
def test_cerrar_mes_removido_devuelve_404(client):
    nivel = _crear_nivel(client, 1, "Elite")
    resp = client.post(
        f"/api/v1/ranking/niveles/{nivel['id']}/cerrar-mes", params={"anio": 2026, "mes": 7}
    )
    assert resp.status_code == 404


def test_listar_cierres_mensuales_removido_devuelve_404(client):
    resp = client.get("/api/v1/ranking/cierres-mensuales")
    assert resp.status_code == 404


# --- Campos de ranking muertos (posición/puntaje) removidos (slice E) -------
# `puntaje_acumulado`/`posicion_actual` dejaron de tener escritor cuando se
# removió `cerrar_mes()` (slice B2). Estos tests prueban que las 2 respuestas
# que los exponían (`/asignaciones`, `/niveles/{id}/tabla`) ya no los
# devuelven, en vez de seguir mostrando un dato congelado como si estuviera
# vivo.
def test_listado_de_asignaciones_no_expone_posicion_ni_puntaje(client):
    nivel = _crear_nivel(client, 1, "Elite")
    persona = _crear_persona(client, "1716667788")
    _asignar_nivel(client, persona["id"], nivel["id"])

    resp = client.get("/api/v1/ranking/asignaciones")
    assert resp.status_code == 200
    fila = resp.json()[0]
    assert "posicionActual" not in fila
    assert "puntajeAcumulado" not in fila
    assert fila["personaId"] == persona["id"]


def test_tabla_de_nivel_no_expone_posicion_ni_puntaje(client):
    nivel = _crear_nivel(client, 2, "Intermedio")
    persona = _crear_persona(client, "1717778899")
    _asignar_nivel(client, persona["id"], nivel["id"])

    resp = client.get(f"/api/v1/ranking/niveles/{nivel['id']}/tabla")
    assert resp.status_code == 200
    fila = resp.json()[0]
    assert "posicionActual" not in fila
    assert "puntajeAcumulado" not in fila
    assert fila["personaId"] == persona["id"]


# --- Residuo competitivo: columnas y campos eliminados ----------------------
# Las tres columnas congeladas (`puntaje_acumulado`, `posicion_actual`,
# `participo`) y el flag `esta_en_ranking` ya no existen: las primeras nunca
# volvieron a tener escritor tras remover el cierre mensual, y el flag no
# tenía ningún camino que lo pusiera en False (la "baja manual" que describía
# el comentario del modelo nunca se implementó), así que era permanentemente
# True para toda fila. Hoy la pertenencia a un nivel se lee de
# `nivel_ranking_id`, que es el único dato que alguien puede mover.
def test_el_modelo_ranking_ya_no_tiene_columnas_del_ranking_competitivo():
    from app.dominio.modelos import Ranking

    columnas = set(Ranking.__table__.columns.keys())
    assert columnas.isdisjoint(
        {"puntaje_acumulado", "posicion_actual", "participo", "esta_en_ranking"}
    ), f"Quedan columnas del ranking competitivo en `ranking`: {sorted(columnas)}"


def test_asignar_nivel_inicial_no_expone_campos_del_ranking_competitivo(client):
    nivel = _crear_nivel(client, 3, "Principiante")
    persona = _crear_persona(client, "1719990011")

    resp = _asignar_nivel(client, persona["id"], nivel["id"])

    assert resp.status_code == 201
    cuerpo = resp.json()
    for campo in ("puntajeAcumulado", "posicionActual", "participo", "estaEnRanking"):
        assert campo not in cuerpo, f"`{campo}` sigue en la respuesta: {cuerpo}"
    assert cuerpo["nivelRankingId"] == nivel["id"]


def test_mover_de_nivel_no_expone_campos_del_ranking_competitivo(client):
    origen = _crear_nivel(client, 4, "Origen")
    destino = _crear_nivel(client, 5, "Destino")
    persona = _crear_persona(client, "1719990022")
    _asignar_nivel(client, persona["id"], origen["id"])

    resp = client.patch(
        f"/api/v1/ranking/{persona['id']}/mover-de-nivel",
        params={"nuevo_nivel_id": destino["id"]},
    )

    assert resp.status_code == 200
    cuerpo = resp.json()
    for campo in ("puntajeAcumulado", "posicionActual", "participo", "estaEnRanking"):
        assert campo not in cuerpo, f"`{campo}` sigue en la respuesta: {cuerpo}"
    assert cuerpo["nivelRankingId"] == destino["id"]


def test_asignaciones_tabla_y_perfil_no_exponen_esta_en_ranking(client):
    nivel = _crear_nivel(client, 6, "Roster")
    persona = _crear_persona(client, "1719990033")
    _asignar_nivel(client, persona["id"], nivel["id"])

    asignaciones = client.get("/api/v1/ranking/asignaciones")
    tabla = client.get(f"/api/v1/ranking/niveles/{nivel['id']}/tabla")
    perfil = client.get(f"/api/v1/ranking/{persona['id']}/perfil")

    assert "estaEnRanking" not in asignaciones.json()[0]
    assert "estaEnRanking" not in tabla.json()[0]
    assert "estaEnRanking" not in perfil.json()


# --- Perfil privado del alumno (E04-RF012) ----------------------------------
def test_perfil_ranking_visible_para_admin_o_entrenador(client):
    nivel = _crear_nivel(client, 1, "Elite")
    persona = _crear_persona(client, "1715556677")
    _asignar_nivel(client, persona["id"], nivel["id"])

    resp = client.get(f"/api/v1/ranking/{persona['id']}/perfil")
    assert resp.status_code == 200
    assert resp.json()["nivelRankingNombre"] == "Elite"


def test_perfil_ranking_no_expone_posicion_ni_puntaje(client):
    """El 'Posición #X · Y pts' que veía el alumno salía de este endpoint
    (`obtener_perfil_alumno`), no de `/niveles/{id}/tabla` como se asumió
    originalmente -- confirmado leyendo el call graph del frontend
    (student-adapter.ts -> GET /ranking/{id}/perfil)."""
    nivel = _crear_nivel(client, 1, "Elite")
    persona = _crear_persona(client, "1718889900")
    _asignar_nivel(client, persona["id"], nivel["id"])

    resp = client.get(f"/api/v1/ranking/{persona['id']}/perfil")
    assert resp.status_code == 200
    body = resp.json()
    assert "posicionActual" not in body
    assert "puntajeAcumulado" not in body
    assert body["nivelRankingNombre"] == "Elite"


def test_perfil_ranking_ajeno_rechazado_para_alumno(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/ranking/999/perfil")
    assert resp.status_code == 403


# --- Notificaciones -----------------------------------------------------------
def test_marcar_notificacion_ajena_como_leida_falla(client, db_session):
    from app.dominio.modelos import Notificacion
    from app.dominio.enums import TipoNotificacion
    # `client` autentica con persona_id=1 (ver docstring del archivo), pero
    # esa identidad no tiene fila propia en `persona` salvo que se cree a
    # propósito. Con el reseteo de secuencias por test (decisión 1.4,
    # sdd/production-readiness), la PRIMERA Persona creada en este test se
    # llevaría justo el id=1 -- por eso creamos primero "la propia" (deja
    # documentada la correspondencia con el token) y luego una segunda,
    # genuinamente distinta, para la notificación ajena. Un id inventado
    # (ej. 999) violaría la FK de `notificacion.persona_id` contra Postgres
    # real, que sí la hace cumplir (a diferencia de la rama SQLite
    # transitoria).
    _crear_persona(client, "1719990000")
    otra_persona = _crear_persona(client, "1719990011")
    assert otra_persona["id"] != 1

    notif = Notificacion(
        persona_id=otra_persona["id"],
        tipo=TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
        mensaje="x",
    )
    db_session.add(notif)
    db_session.commit()
    db_session.refresh(notif)

    resp = client.patch(f"/api/v1/ranking/notificaciones/{notif.id}/leer")
    assert resp.status_code == 403


# --- Roster ligero para asignación de nivel ---------------------------------
# El panel de Nivel del entrenador (`/trainer/nivel`) necesita la lista de
# alumnos y su nivel actual. Antes la pedía a `GET /personas/` vía
# `/api/members`, que es ADMINISTRADOR-only por exponer PII (cédula, teléfono,
# fecha de nacimiento) -> el entrenador recibía un 403 real y la página no
# cargaba nunca. `GET /ranking/alumnos-con-nivel` es el roster mínimo
# equivalente, legible por ENTRENADOR.
def test_listar_alumnos_con_nivel_lo_puede_leer_un_entrenador(client_entrenador):
    resp = client_entrenador.get("/api/v1/ranking/alumnos-con-nivel")

    assert resp.status_code == 200


def test_listar_alumnos_con_nivel_rechaza_a_un_alumno(client_sin_permisos):
    resp = client_sin_permisos.get("/api/v1/ranking/alumnos-con-nivel")

    assert resp.status_code == 403


def test_listar_alumnos_con_nivel_devuelve_el_roster_con_y_sin_nivel(
    client_entrenador, db_session
):
    """Las dos pruebas de arriba solo miran el status code: el cuerpo de la
    respuesta no tenía ninguna cobertura. Este test fija la forma del payload
    (camelCase) y, sobre todo, que un alumno SIN nivel asignado sigue estando
    en el roster con `nivelRankingId` en null."""
    from datetime import date

    from app.dominio.enums import TipoRol
    from app.dominio.modelos import NivelRanking, Persona, Ranking, Rol, Usuario

    def _alta_alumno(nombres, apellidos, cedula):
        persona = Persona(
            nombres=nombres, apellidos=apellidos, cedula=cedula,
            fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
        )
        db_session.add(persona)
        db_session.flush()
        db_session.add(Usuario(
            correo=f"alumno{cedula}@cataclub.test", contrasenia="hash",
            persona_id=persona.id,
            roles=[Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")],
        ))
        db_session.commit()
        return persona

    nivel = NivelRanking(numero_nivel=1, nombre="Elite")
    db_session.add(nivel)
    db_session.commit()

    con_nivel = _alta_alumno("Ana", "Alvarez", "1710034400")
    sin_nivel = _alta_alumno("Beto", "Benitez", "1710034401")
    db_session.add(Ranking(persona_id=con_nivel.id, nivel_ranking_id=nivel.id))
    db_session.commit()

    resp = client_entrenador.get("/api/v1/ranking/alumnos-con-nivel")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert [item["personaId"] for item in cuerpo] == [con_nivel.id, sin_nivel.id]
    assert cuerpo[0] == {
        "personaId": con_nivel.id, "nombres": "Ana", "apellidos": "Alvarez",
        "nivelRankingId": nivel.id,
    }
    assert cuerpo[1]["nivelRankingId"] is None
