from datetime import date

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA
from app.dominio.modelos import Persona, Usuario, FichaMedica
from app.seguridad.gestor_auth import GestorAutenticacion


def _payload_persona(cedula="1710034065"):
    return {
        "nombres": "Ana",
        "apellidos": "Torres",
        "cedula": cedula,
        "fecha_nacimiento": "2010-05-14",
        "telefono": "0991234567",
    }


def test_registrar_persona(client):
    resp = client.post("/api/v1/personas/", json=_payload_persona())
    assert resp.status_code == 201
    data = resp.json()
    assert data["cedula"] == "1710034065"
    assert data["id"] > 0


def test_no_permite_cedula_duplicada(client):
    client.post("/api/v1/personas/", json=_payload_persona())
    resp = client.post("/api/v1/personas/", json=_payload_persona())
    assert resp.status_code == 400
    assert resp.json()["detail"] == MENSAJE_IDENTIDAD_DUPLICADA


def test_obtener_persona_inexistente_da_404(client):
    resp = client.get("/api/v1/personas/999")
    assert resp.status_code == 404


def test_representante_reflexivo(client):
    representante = client.post("/api/v1/personas/", json=_payload_persona("1710034065")).json()
    hijo = client.post(
        "/api/v1/personas/",
        json={**_payload_persona("1710034073"), "representante_id": representante["id"]},
    ).json()

    resp = client.get(f"/api/v1/personas/{representante['id']}/representados")
    assert resp.status_code == 200
    ids = [p["id"] for p in resp.json()]
    assert hijo["id"] in ids


# --- GET /personas/{persona_id}/representados: ownership (issue #122 IDOR) --
# Antes solo exigía un JWT válido, sin comparar `persona_id` contra el token
# — cualquier autenticado podía enumerar cédula/teléfono/fecha_nacimiento/
# foto_url de los dependientes de OTRO representante. Mismo patrón de
# ownership que el POST hermano (`crear_representado`), con la excepción de
# que ADMINISTRADOR/ENTRENADOR sí necesitan consultar representados de
# cualquier persona (uso legítimo en el panel admin).

def test_listar_representados_propio_da_200(client, db_session):
    representante = _crear_persona_representante(db_session, cedula="1710034065")
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    resp = client.get(f"/api/v1/personas/{representante.id}/representados")
    assert resp.status_code == 200


def test_listar_representados_de_otra_persona_da_403_sin_filtrar_existencia(client, db_session):
    representante = _crear_persona_representante(db_session, cedula="1710034065")
    otro_representante = _crear_persona_representante(db_session, cedula="1710034073")
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    resp = client.get(f"/api/v1/personas/{otro_representante.id}/representados")
    assert resp.status_code == 403
    detalle = resp.json()["detail"].lower()
    assert "no encontrad" not in detalle


def test_listar_representados_administrador_puede_consultar_cualquier_persona(client, db_session):
    representante = _crear_persona_representante(db_session, cedula="1710034065")
    _restaurar_override_token(persona_id=999, roles=["ADMINISTRADOR"])

    resp = client.get(f"/api/v1/personas/{representante.id}/representados")
    assert resp.status_code == 200


def test_listar_representados_entrenador_puede_consultar_cualquier_persona(client, db_session):
    representante = _crear_persona_representante(db_session, cedula="1710034065")
    _restaurar_override_token(persona_id=999, roles=["ENTRENADOR"])

    resp = client.get(f"/api/v1/personas/{representante.id}/representados")
    assert resp.status_code == 200


def test_actualizar_persona(client):
    persona = client.post("/api/v1/personas/", json=_payload_persona()).json()

    resp = client.patch(f"/api/v1/personas/{persona['id']}", json={"telefono": "0987654321"})
    assert resp.status_code == 200
    assert resp.json()["telefono"] == "0987654321"


# --- #312 / hallazgo #65: nombre vacío daba un 422 genérico ------------------
# `nombres`/`apellidos` en `PersonaUpdateDTO` dependían del `min_length=1` de
# Pydantic, cuyo mensaje ("String should have at least 1 character") es
# inglés de la librería -- lo mismo que `El teléfono solo puede tener
# dígitos.` evita para teléfono/cédula desde PR 4b (issue #228), pero nunca se
# extendió a nombres/apellidos.
def test_actualizar_persona_con_nombre_vacio_da_mensaje_claro(client):
    persona = client.post("/api/v1/personas/", json=_payload_persona()).json()

    resp = client.patch(f"/api/v1/personas/{persona['id']}", json={"nombres": ""})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "El nombre es obligatorio."


def test_actualizar_persona_con_apellido_vacio_da_mensaje_claro(client):
    persona = client.post("/api/v1/personas/", json=_payload_persona()).json()

    resp = client.patch(f"/api/v1/personas/{persona['id']}", json={"apellidos": ""})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "El apellido es obligatorio."


# El tramo de borrado que vivía en este test murió con `DELETE /personas/{id}`:
# la baja de una persona hoy es lógica y se prueba en
# `test_baja_logica_persona.py`.


# --- GET /personas/entrenadores: murió con la relación entrenador–horario ---
# (issue #13, docs/product/concepto-alcance-modelo.md §4). El selector de entrenador
# del formulario de horarios era su único consumidor; sin titular en el
# horario la ruta no tiene a quién alimentar. Guardia estructural (misma
# técnica que `test_orden_rutas.py`) para que no reaparezca.
def test_no_existe_ruta_de_listado_de_entrenadores():
    from app.presentacion.routers import personas_router

    rutas = [r.path for r in personas_router.router.routes]
    assert "/personas/entrenadores" not in rutas


# --- POST /personas/{persona_id}/representados (portal autoservicio) --------
# El representante ya está autenticado (misma `client` fixture de conftest.py,
# solo se reemplaza el override del token — mismo patrón que
# test_auth_perfil_propio.py) y agrega un dependiente desde el portal, sin
# crear un `Usuario` nuevo ni asignarle ningún rol.

def _crear_persona_representante(db_session, cedula: str = "1710034065") -> Persona:
    """Persona adulta (no requiere representante propio) que actuará como
    representante del nuevo dependiente."""
    persona = Persona(
        nombres="Marcela", apellidos="Vega", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991230000",
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _restaurar_override_token(correo="representante@cataclub.test", persona_id=1, roles=None):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": correo, "persona_id": persona_id, "roles": roles or [],
    }


def _payload_representado(cedula=cedula_valida(520), ficha_medica=None):
    payload = {
        "nombres": "Lucas",
        "apellidos": "Vega",
        "cedula": cedula,
        "fecha_nacimiento": "2015-05-14",
        "telefono": "0991230001",
    }
    if ficha_medica is not None:
        payload["ficha_medica"] = ficha_medica
    return payload


def test_crear_representado_happy_path(client, db_session):
    representante = _crear_persona_representante(db_session)
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    ficha_medica = {
        "tipo_sangre": "O_POSITIVO",
        "enfermedades": ["Asma"],
        "alergias": "Polen",
        "contacto_emergencia": "Marcela Vega",
        "telefono_emergencia": "0991230000",
    }
    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=_payload_representado(ficha_medica=ficha_medica),
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["cedula"] == cedula_valida(520)
    assert data["representanteId"] == representante.id

    hijo = db_session.query(Persona).filter(Persona.cedula == cedula_valida(520)).one()
    assert hijo.representante_id == representante.id
    assert hijo.ficha_medica is not None
    assert hijo.ficha_medica.tipo_sangre.value == "O_POSITIVO"
    assert [e.nombre_enfermedad for e in hijo.ficha_medica.enfermedades] == ["Asma"]
    # No debe crearse Usuario ni rol alguno para el dependiente self-service.
    assert db_session.query(Usuario).filter(Usuario.persona_id == hijo.id).first() is None


def test_crear_representado_persona_id_no_coincide_con_token_da_403_sin_filtrar_existencia(client, db_session):
    representante = _crear_persona_representante(db_session, cedula="1710034065")
    otro_representante = _crear_persona_representante(db_session, cedula="1710034073")
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{otro_representante.id}/representados",
        json=_payload_representado(),
    )
    assert resp.status_code == 403
    detalle = resp.json()["detail"].lower()
    # La respuesta no debe insinuar que el persona_id de la URL existe o
    # pertenece a otro representante (mismo mensaje genérico que GestorPermisos).
    assert "no encontrad" not in detalle
    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(520)).first() is None


def test_crear_representado_sin_rol_representante_da_403_sin_auto_asignar(client, db_session):
    persona = _crear_persona_representante(db_session, cedula="1710034065")
    _restaurar_override_token(persona_id=persona.id, roles=["ALUMNO"])

    resp = client.post(
        f"/api/v1/personas/{persona.id}/representados",
        json=_payload_representado(),
    )
    assert resp.status_code == 403
    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(520)).first() is None


def test_crear_representado_cedula_duplicada_rechazada(client, db_session):
    representante = _crear_persona_representante(db_session)
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    # Ya existe una persona con esa cédula (el propio representante, para
    # simplificar el fixture — cualquier Persona existente sirve).
    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=_payload_representado(cedula=representante.cedula),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == MENSAJE_IDENTIDAD_DUPLICADA

    total_personas = db_session.query(Persona).count()
    assert total_personas == 1  # solo el representante, nada se creó
    assert db_session.query(FichaMedica).count() == 0


def test_crear_representado_ficha_medica_invalida_rechazada(client, db_session):
    representante = _crear_persona_representante(db_session)
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=_payload_representado(ficha_medica={"tipo_sangre": "NO_ES_UN_TIPO_VALIDO"}),
    )
    assert resp.status_code == 422

    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(520)).first() is None
    assert db_session.query(FichaMedica).count() == 0


# --- Flujo 2: representado con credenciales (menores con cuenta propia) ----

def test_crear_representado_con_credenciales_crea_usuario_y_rol(client, db_session):
    representante = _crear_persona_representante(db_session)
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    payload = _payload_representado()
    payload["correo"] = "menor@test.com"
    payload["contrasenia"] = "clave12345"

    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=payload,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["cedula"] == cedula_valida(520)

    hijo = db_session.query(Persona).filter(Persona.cedula == cedula_valida(520)).one()
    usuario = db_session.query(Usuario).filter(Usuario.persona_id == hijo.id).one()
    assert usuario.correo == "menor@test.com"
    assert usuario.contrasenia != "clave12345"  # hasheada
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.ALUMNO}


def test_crear_representado_sin_credenciales_no_crea_usuario(client, db_session):
    representante = _crear_persona_representante(db_session)
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=_payload_representado(),
    )
    assert resp.status_code == 201
    hijo = db_session.query(Persona).filter(Persona.cedula == cedula_valida(520)).one()
    assert db_session.query(Usuario).filter(Usuario.persona_id == hijo.id).first() is None


def test_crear_representado_correo_duplicado_rechazada(client, db_session):
    representante = _crear_persona_representante(db_session, cedula="1710034065")
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    payload = _payload_representado()
    payload["correo"] = "duplicado@test.com"
    payload["contrasenia"] = "clave12345"

    resp1 = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=payload,
    )
    assert resp1.status_code == 201

    payload2 = _payload_representado(cedula=cedula_valida(521))
    payload2["correo"] = "duplicado@test.com"
    payload2["contrasenia"] = "clave12345"

    resp2 = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=payload2,
    )
    assert resp2.status_code == 400
    assert resp2.json()["detail"] == MENSAJE_IDENTIDAD_DUPLICADA


def test_crear_representado_con_credenciales_correo_invalido_rechazado(client, db_session):
    representante = _crear_persona_representante(db_session)
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    payload = _payload_representado()
    payload["correo"] = "no-es-correo"
    payload["contrasenia"] = "clave12345"

    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=payload,
    )
    assert resp.status_code == 422


def test_crear_representado_con_credenciales_contrasenia_corta_rechazada(client, db_session):
    representante = _crear_persona_representante(db_session)
    _restaurar_override_token(persona_id=representante.id, roles=["REPRESENTANTE"])

    payload = _payload_representado()
    payload["correo"] = "menor@test.com"
    payload["contrasenia"] = "123"

    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=payload,
    )
    assert resp.status_code == 422


def test_crear_representado_admin_puede_usar_endpoint(client, db_session):
    representante = _crear_persona_representante(db_session)
    _restaurar_override_token(persona_id=999, roles=["ADMINISTRADOR"])

    resp = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=_payload_representado(),
    )
    assert resp.status_code == 201


# --- Búsqueda (autocomplete): `skip`/`limit` reales -------------------------
# `buscar_por_nombre` declaraba `skip`/`limit` en toda la cadena (router ->
# servicio -> repositorio) pero el repositorio nunca los aplicaba a la
# sentencia. El `le=50` del router era decorativo: una `q` de dos caracteres
# que matcheara a todo el club devolvía el club entero.
def _crear_personas_buscables(client, cantidad: int) -> None:
    for i in range(cantidad):
        client.post(
            "/api/v1/personas/",
            json={
                "nombres": f"Alumno{i}", "apellidos": "Torres",
                "cedula": cedula_valida(522 + i), "fecha_nacimiento": "2010-05-14",
                "telefono": "0991234567",
            },
        )


def test_buscar_personas_respeta_el_limit(client):
    _crear_personas_buscables(client, cantidad=5)

    resp = client.get("/api/v1/personas/buscar?q=Torres&limit=2")

    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_buscar_personas_respeta_el_skip(client):
    _crear_personas_buscables(client, cantidad=5)

    primera_pagina = client.get("/api/v1/personas/buscar?q=Torres&skip=0&limit=2").json()
    segunda_pagina = client.get("/api/v1/personas/buscar?q=Torres&skip=2&limit=2").json()

    assert len(primera_pagina) == 2
    assert len(segunda_pagina) == 2
    assert {p["id"] for p in primera_pagina}.isdisjoint({p["id"] for p in segunda_pagina})


# --- Búsqueda: nombre completo (auditoría 2026-08-10) ------------------------
# `Persona.nombres.ilike(q) | Persona.apellidos.ilike(q)` comparaba la `q`
# COMPLETA contra cada columna por separado, nunca contra la concatenación:
# "Emilio Zambrano" no matcheaba ni nombres="Emilio" ni apellidos="Zambrano"
# enteros. Fallaba en silencio -- sin error, con el desplegable vacío -- y lo
# comparte StudentSearch (`/reports` y `/trainer/attendance/history`).
def _crear_persona_buscable(client, nombres: str, apellidos: str, cedula: str) -> None:
    client.post(
        "/api/v1/personas/",
        json={
            "nombres": nombres, "apellidos": apellidos, "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    )


def test_buscar_nombre_completo_encuentra_a_la_persona(client):
    """El caso real que reportó la auditoría: cero resultados con nombre y
    apellido juntos, aunque cada uno por separado sí encontraba."""
    _crear_persona_buscable(client, "Emilio", "Zambrano", cedula_valida(527))

    resp = client.get("/api/v1/personas/buscar", params={"q": "Emilio Zambrano"})

    assert resp.status_code == 200
    assert any(p["apellidos"] == "Zambrano" for p in resp.json())


def test_buscar_nombre_completo_en_orden_invertido_encuentra(client):
    """Mucha gente tipea apellido primero."""
    _crear_persona_buscable(client, "Emilio", "Zambrano", cedula_valida(528))

    resp = client.get("/api/v1/personas/buscar", params={"q": "Zambrano Emilio"})

    assert resp.status_code == 200
    assert any(p["apellidos"] == "Zambrano" for p in resp.json())


def test_buscar_con_apellido_compuesto_parcial_encuentra(client):
    """"Ariana Chavez" tiene que encontrar a "Ariana Chavez Bravo": el
    apellido compuesto no se busca completo, alcanza con una porción."""
    _crear_persona_buscable(client, "Ariana", "Chavez Bravo", cedula_valida(529))

    resp = client.get("/api/v1/personas/buscar", params={"q": "Ariana Chavez"})

    assert resp.status_code == 200
    assert any(p["apellidos"] == "Chavez Bravo" for p in resp.json())


def test_buscar_con_espacios_de_mas_encuentra(client):
    _crear_persona_buscable(client, "Emilio", "Zambrano", cedula_valida(530))

    resp = client.get("/api/v1/personas/buscar", params={"q": "Emilio   Zambrano"})

    assert resp.status_code == 200
    assert any(p["apellidos"] == "Zambrano" for p in resp.json())


def test_buscar_solo_nombre_sigue_funcionando(client):
    _crear_persona_buscable(client, "Emilio", "Zambrano", cedula_valida(531))

    resp = client.get("/api/v1/personas/buscar", params={"q": "Emilio"})

    assert resp.status_code == 200
    assert any(p["apellidos"] == "Zambrano" for p in resp.json())


def test_buscar_solo_apellido_sigue_funcionando(client):
    _crear_persona_buscable(client, "Emilio", "Zambrano", cedula_valida(532))

    resp = client.get("/api/v1/personas/buscar", params={"q": "Zambrano"})

    assert resp.status_code == 200
    assert any(p["apellidos"] == "Zambrano" for p in resp.json())


def test_buscar_sin_resultados_devuelve_lista_vacia_sin_romperse(client):
    _crear_persona_buscable(client, "Emilio", "Zambrano", cedula_valida(533))

    resp = client.get("/api/v1/personas/buscar", params={"q": "Nadie Inexistente"})

    assert resp.status_code == 200
    assert resp.json() == []


# --- `GET /personas/`: paginación acotada -----------------------------------
# Era el único de los cuatro endpoints paginados declarado con defaults planos
# de Python (`skip: int = 0, limit: int = 50`), sin `Query(...)`: aceptaba
# `limit=100000` y `skip=-5`. El tope es 200 porque el BFF del frontend pide
# `/personas/?limit=200` (`PERSONAS_PAGE_LIMIT`) desde la pantalla de Miembros,
# el adaptador de asistencias y el de pagos.
def test_listar_personas_respeta_skip_y_limit(client):
    _crear_personas_buscables(client, cantidad=3)

    resp = client.get("/api/v1/personas/?skip=1&limit=1")

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert body["skip"] == 1
    assert body["limit"] == 1
    assert len(body["items"]) == 1


def test_listar_personas_rechaza_limit_sobre_el_tope(client):
    assert client.get("/api/v1/personas/?limit=201").status_code == 422


def test_listar_personas_rechaza_limit_cero(client):
    assert client.get("/api/v1/personas/?limit=0").status_code == 422


def test_listar_personas_rechaza_skip_negativo(client):
    assert client.get("/api/v1/personas/?skip=-5").status_code == 422


def test_listar_personas_acepta_el_limit_del_tope(client):
    """200 es el valor exacto que pide el BFF de la pantalla de Miembros:
    el borde tiene que seguir siendo válido."""
    assert client.get("/api/v1/personas/?limit=200").status_code == 200
