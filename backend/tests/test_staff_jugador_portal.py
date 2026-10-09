"""Staff que también juega: el lado jugador de una cuenta ADMINISTRADOR o
ENTRENADOR, vía la API pública.

Contrato (un rol por cuenta, sin segunda cuenta ni migración): jugador es quien
tiene una membresía que habilita entrenar (ACTIVA o VENCIDA,
`MembresiaRepositorio.puede_entrenar`), no quien tiene un rol. Ninguno de los
endpoints que usan las vistas /student* para los datos PROPIOS decide por rol:
autorizan por `PoliticaAccesoPersona` (titular) o solo por token, así que el
staff dueño de una membresía ya ve y gestiona lo suyo. Estas pruebas fijan ese
contrato y sus límites:

  - el staff jugador accede a sus datos propios (portal, membresías, pagos,
    coberturas, asistencia, horarios, ficha médica, beneficio) y paga lo suyo;
  - un ENTRENADOR no accede a los datos de otra persona (el ADMINISTRADOR sí,
    por diseño: es quien opera Miembros);
  - la autoinscripción propia y los endpoints de representado siguen cerrados
    al staff, y las llamadas rechazadas no escriben nada.
"""
import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import Membresia, Pago, Persona
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm,
)

API = "/api/v1"
ROLES_STAFF = ["ADMINISTRADOR", "ENTRENADOR"]
ESTADOS_QUE_HABILITAN = [EstadoMembresia.ACTIVA, EstadoMembresia.VENCIDA]


def _como(persona_id, rol):
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": f"p{persona_id}@cataclub.test", "persona_id": persona_id, "roles": [rol],
    }


def _staff_jugador(db_session, base, estado=EstadoMembresia.ACTIVA):
    persona = crear_persona_orm(db_session, cedula_valida(base), nombres="Staff", apellidos="Jugador")
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, estado)
    db_session.commit()
    return persona, membresia, tipo


def _ajena(db_session, base):
    persona = crear_persona_orm(db_session, cedula_valida(base), nombres="Otra", apellidos="Persona")
    tipo = crear_tipo_membresia_orm(db_session, categoria="Juvenil")
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    db_session.commit()
    return persona, membresia


# --- Datos propios del staff jugador: permitido ---------------------------

@pytest.mark.parametrize("rol", ROLES_STAFF)
@pytest.mark.parametrize("estado", ESTADOS_QUE_HABILITAN)
def test_staff_jugador_accede_a_sus_datos_propios(client, db_session, rol, estado):
    persona, membresia, _ = _staff_jugador(db_session, 9100, estado)
    _como(persona.id, rol)

    portal = client.get(f"{API}/portal/alumno/{persona.id}")
    assert portal.status_code == 200, portal.text
    assert portal.json()["titular"]["persona"]["id"] == persona.id
    assert [m["id"] for m in portal.json()["titular"]["membresias"]] == [membresia.id]
    assert portal.json()["representados"] == []

    propias = client.get(f"{API}/membresias/mias")
    assert propias.status_code == 200
    assert [m["id"] for m in propias.json()] == [membresia.id]

    for ruta in (
        f"/membresias/persona/{persona.id}",
        f"/membresias/pagos/persona/{persona.id}",
        f"/membresias/coberturas/persona/{persona.id}",
        f"/asistencias/persona/{persona.id}",
        f"/asistencias/alumnos/{persona.id}/horarios",
        f"/personas/{persona.id}/beneficio",
        f"/membresias/{membresia.id}",
    ):
        respuesta = client.get(f"{API}{ruta}")
        assert respuesta.status_code == 200, (ruta, respuesta.text)


@pytest.mark.parametrize("rol", ROLES_STAFF)
def test_staff_jugador_mayor_de_edad_lee_y_edita_su_ficha_medica(client, db_session, rol):
    persona, _, _ = _staff_jugador(db_session, 9110)
    _como(persona.id, rol)

    edicion = client.patch(f"{API}/fichas-medicas/persona/{persona.id}", json={
        "tipo_sangre": "O_POSITIVO", "telefono_emergencia": "0991112233",
        "alergias": "Polen", "enfermedades": ["Ninguno"],
    })
    assert edicion.status_code == 200, edicion.text

    lectura = client.get(f"{API}/fichas-medicas/persona/{persona.id}")
    assert lectura.status_code == 200
    assert lectura.json()["alergias"] == "Polen"


@pytest.mark.parametrize("rol", ROLES_STAFF)
def test_staff_jugador_registra_el_pago_de_su_propia_membresia(client, db_session, rol):
    persona, membresia, _ = _staff_jugador(db_session, 9120)
    _como(persona.id, rol)

    respuesta = client.post(f"{API}/membresias/pagos", json={
        "meses": 1, "tipo_pago": "TRANSFERENCIA",
        "persona_id": persona.id, "membresia_id": membresia.id,
    })

    assert respuesta.status_code == 201, respuesta.text
    assert respuesta.json()["personaId"] == persona.id
    assert db_session.query(Pago).filter(Pago.persona_id == persona.id).count() == 1


# --- Staff que no es jugador: solo ve lo suyo, que está vacío ----------------

@pytest.mark.parametrize("rol", ROLES_STAFF)
def test_staff_sin_membresia_no_recibe_membresias_de_nadie(client, db_session, rol):
    staff = crear_persona_orm(db_session, cedula_valida(9130), nombres="Staff", apellidos="Solo")
    _ajena(db_session, 9131)
    _como(staff.id, rol)

    portal = client.get(f"{API}/portal/alumno/{staff.id}")
    assert portal.status_code == 200
    assert portal.json()["titular"]["membresias"] == []
    assert portal.json()["representados"] == []

    assert client.get(f"{API}/membresias/mias").json() == []
    assert client.get(f"{API}/membresias/pagos/persona/{staff.id}").json() == []


# --- Datos de otra persona: el ENTRENADOR no pasa -------------------------

@pytest.mark.parametrize("ruta", [
    "/portal/alumno/{ajena}",
    "/membresias/persona/{ajena}",
    "/membresias/pagos/persona/{ajena}",
    "/membresias/coberturas/persona/{ajena}",
    "/membresias/mias?persona_id={ajena}",
    "/fichas-medicas/persona/{ajena}",
    "/personas/{ajena}/beneficio",
    "/membresias/{membresia_ajena}",
])
def test_entrenador_jugador_no_accede_a_datos_de_otra_persona(client, db_session, ruta):
    propia, _, _ = _staff_jugador(db_session, 9140)
    ajena, membresia_ajena = _ajena(db_session, 9141)
    _como(propia.id, "ENTRENADOR")

    respuesta = client.get(API + ruta.format(ajena=ajena.id, membresia_ajena=membresia_ajena.id))

    assert respuesta.status_code == 403, (ruta, respuesta.text)


def test_entrenador_jugador_no_paga_ni_edita_a_nombre_de_otra_persona(client, db_session):
    propia, _, _ = _staff_jugador(db_session, 9150)
    ajena, membresia_ajena = _ajena(db_session, 9151)
    _como(propia.id, "ENTRENADOR")

    pago = client.post(f"{API}/membresias/pagos", json={
        "meses": 1, "tipo_pago": "TRANSFERENCIA",
        "persona_id": ajena.id, "membresia_id": membresia_ajena.id,
    })
    ficha = client.patch(f"{API}/fichas-medicas/persona/{ajena.id}", json={"alergias": "Polen"})

    assert pago.status_code == 403
    assert ficha.status_code == 403
    assert db_session.query(Pago).count() == 0


# --- Autoinscripción y representados: cerrados al staff ----------------------

@pytest.mark.parametrize("rol", ROLES_STAFF)
def test_staff_sin_membresia_no_puede_autoinscribirse(client, db_session, rol):
    staff = crear_persona_orm(db_session, cedula_valida(9160), nombres="Staff", apellidos="Solo")
    tipo = crear_tipo_membresia_orm(db_session)
    db_session.commit()
    _como(staff.id, rol)

    respuesta = client.post(f"{API}/membresias/propia", json={"tipo_membresia_id": tipo.id})

    assert respuesta.status_code == 403
    assert db_session.query(Membresia).count() == 0


@pytest.mark.parametrize("rol", ROLES_STAFF)
def test_staff_no_usa_los_endpoints_de_representado(client, db_session, rol):
    staff, _, _ = _staff_jugador(db_session, 9170)
    personas_antes = db_session.query(Persona).count()
    _como(staff.id, rol)

    crear = client.post(f"{API}/personas/me/representados", json={
        "nombres": "Hijo", "apellidos": "Nuevo", "fecha_nacimiento": "2015-01-01",
        "cedula": cedula_valida(9171), "telefono": "0990001111",
    })
    pagar = client.post(f"{API}/membresias/representado/pago", json={})

    assert crear.status_code == 403
    assert pagar.status_code == 403
    assert db_session.query(Persona).count() == personas_antes
    assert db_session.query(Pago).count() == 0
