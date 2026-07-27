from datetime import date

from app.dominio.enums import TipoRol
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA
from app.dominio.modelos import Persona, Rol, Usuario, FichaMedica
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.conftest import crear_entrenador


def _crear_persona_con_rol(db_session, cedula: str, tipo_rol: TipoRol) -> int:
    """Crea una persona con un `Usuario`/`Rol` DISTINTO a ENTRENADOR y
    devuelve su persona_id. Usado para probar que `/personas/entrenadores`
    realmente filtra por `tipo_rol == ENTRENADOR` (INNER JOIN por rol), no
    solo por tener o no tener un `Usuario` asociado — de lo contrario un
    filtro roto que devolviera "cualquier persona con cualquier rol" pasaría
    el test igual."""
    persona = Persona(
        nombres="Marta", apellidos="Salazar", cedula=cedula,
        fecha_nacimiento=date(1985, 3, 20), telefono="0993334444",
    )
    db_session.add(persona)
    db_session.flush()
    rol = Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value)
    usuario = Usuario(
        correo=f"otrorol{cedula}@cataclub.test",
        contrasenia="hash", persona_id=persona.id, roles=[rol],
    )
    db_session.add(usuario)
    db_session.commit()
    return persona.id


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


def test_actualizar_y_eliminar_persona(client):
    persona = client.post("/api/v1/personas/", json=_payload_persona()).json()

    resp = client.patch(f"/api/v1/personas/{persona['id']}", json={"telefono": "0987654321"})
    assert resp.status_code == 200
    assert resp.json()["telefono"] == "0987654321"

    resp = client.delete(f"/api/v1/personas/{persona['id']}")
    assert resp.status_code == 204

    resp = client.get(f"/api/v1/personas/{persona['id']}")
    assert resp.status_code == 404


# --- GET /personas/entrenadores: selector real de entrenador (dropdown) ----
def test_listar_entrenadores_devuelve_solo_personas_con_rol_entrenador(client, db_session):
    entrenador_id = crear_entrenador(db_session, "1710034065")
    # Persona CON Usuario/Rol pero de un rol distinto (ADMINISTRADOR) — sin
    # esta fixture, el test pasaría igual aunque el filtro de rol estuviera
    # roto (ej. si `listar_por_rol` devolviera cualquier persona con
    # cualquier rol asignado, no solo ENTRENADOR), porque la única otra
    # persona ("alumno" abajo) queda excluida solo por no tener Usuario.
    administrador_id = _crear_persona_con_rol(db_session, "1710034081", TipoRol.ADMINISTRADOR)
    alumno = client.post("/api/v1/personas/", json=_payload_persona("1710034073")).json()

    resp = client.get("/api/v1/personas/entrenadores")
    assert resp.status_code == 200
    data = resp.json()
    ids = [e["id"] for e in data]
    assert entrenador_id in ids
    assert administrador_id not in ids
    assert alumno["id"] not in ids
    entrenador = next(e for e in data if e["id"] == entrenador_id)
    assert entrenador["nombreCompleto"] == "Carlos Ruiz"


def test_listar_entrenadores_vacio_cuando_no_hay_ninguno(client):
    resp = client.get("/api/v1/personas/entrenadores")
    assert resp.status_code == 200
    assert resp.json() == []


def test_listar_entrenadores_requiere_autenticacion(client_sin_token):
    resp = client_sin_token.get("/api/v1/personas/entrenadores")
    assert resp.status_code == 401


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


def _payload_representado(cedula="1723456789", ficha_medica=None):
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
    assert data["cedula"] == "1723456789"
    assert data["representanteId"] == representante.id

    hijo = db_session.query(Persona).filter(Persona.cedula == "1723456789").one()
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
    assert db_session.query(Persona).filter(Persona.cedula == "1723456789").first() is None


def test_crear_representado_sin_rol_representante_da_403_sin_auto_asignar(client, db_session):
    persona = _crear_persona_representante(db_session, cedula="1710034065")
    _restaurar_override_token(persona_id=persona.id, roles=["ALUMNO"])

    resp = client.post(
        f"/api/v1/personas/{persona.id}/representados",
        json=_payload_representado(),
    )
    assert resp.status_code == 403
    assert db_session.query(Persona).filter(Persona.cedula == "1723456789").first() is None


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

    assert db_session.query(Persona).filter(Persona.cedula == "1723456789").first() is None
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
    assert data["cedula"] == "1723456789"

    hijo = db_session.query(Persona).filter(Persona.cedula == "1723456789").one()
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
    hijo = db_session.query(Persona).filter(Persona.cedula == "1723456789").one()
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

    payload2 = _payload_representado(cedula="1723456790")
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
