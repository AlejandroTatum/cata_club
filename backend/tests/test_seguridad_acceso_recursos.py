"""
Acceso a recursos de terceros (IDOR) desde una sesión autenticada cualquiera.

El proyecto ya tiene el criterio correcto escrito y probado en varios lugares
(`MembresiaServicio.listar_membresias_por_persona`, `PagoServicio.
listar_pagos_de_persona`, `GET /ranking/{persona_id}/perfil`): dueño, su
representante, o ADMINISTRADOR. El problema es que ese criterio se aplicó
endpoint por endpoint, a mano, y quedaron hermanos sin cubrir: alcanzaba con
tener CUALQUIER sesión válida para leer el recurso de otra persona pasando su
id en la URL (enumerable, porque son enteros consecutivos).

Estos tests fijan el criterio ya existente sobre los endpoints que quedaron
afuera.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.dominio.enums import (
    Categoria, DiaSemana, EstadoAsistencia, EstadoMembresia, EstadoPago,
    NivelTecnicoAlumno, TipoModalidad, TipoPago,
)
from app.dominio.modelos import (
    AntecedentesClub, Asistencia, HorarioEntrenamiento, Membresia, Pago,
    Persona, TipoMembresia,
)
from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app

# `persona_id` del intruso: no es dueño ni representante de nadie en estos tests.
PERSONA_ID_INTRUSO = 999


@pytest.fixture()
def client_ajeno(db_session):
    """Sesión ALUMNO válida, sin vínculo alguno con la persona objetivo.

    Es el escenario realista: no un anónimo (esos ya reciben 401), sino
    cualquier cuenta del club mirando el recurso de otro socio.
    """
    def _sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "intruso@cataclub.test",
        "persona_id": PERSONA_ID_INTRUSO,
        "roles": ["ALUMNO"],
    }
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def victima(db_session):
    persona = Persona(
        nombres="Victima", apellidos="Ajena", cedula="1710034065",
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def test_no_puede_leer_pii_de_otra_persona(client_ajeno, victima):
    """`PersonaResponseDTO` expone cédula, teléfono y fecha de nacimiento.

    `GET /personas/` ya se restringió a ADMINISTRADOR por exactamente esta
    razón; su hermano por id había quedado abierto, así que el roster completo
    seguía siendo alcanzable de a una persona por vez.
    """
    respuesta = client_ajeno.get(f"/api/v1/personas/{victima.id}")
    assert respuesta.status_code == 403


def test_no_puede_leer_pago_de_otra_persona(client_ajeno, victima, db_session):
    """Un pago expone monto y `voucher_url` (la evidencia bancaria en Cloudinary)."""
    tipo = TipoMembresia(
        categoria="ADULTOS", franja_horaria="AM",
        precio=Decimal("30.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db_session.add(tipo)
    db_session.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
        fecha_activacion=datetime.now(timezone.utc),
        persona_id=victima.id, tipo_membresia_id=tipo.id,
    )
    db_session.add(membresia)
    db_session.flush()
    pago = Pago(
        monto=Decimal("30.00"), tipo_pago=TipoPago.TRANSFERENCIA,
        estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        fecha_inicio=date(2029, 1, 1), fecha_fin=date(2029, 2, 1),
        persona_id=victima.id, membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()

    respuesta = client_ajeno.get(f"/api/v1/membresias/pagos/{pago.id}")
    assert respuesta.status_code == 403


def test_no_puede_leer_historial_de_asistencia_ajeno(client_ajeno, victima, db_session):
    """La asistencia de un menor es, en la práctica, su rutina de presencia."""
    entrenador = Persona(
        nombres="Carlos", apellidos="Ruiz", cedula="1710034066",
        fecha_nacimiento=date(1985, 1, 1), telefono="0991112222",
    )
    db_session.add(entrenador)
    db_session.flush()
    horario = HorarioEntrenamiento(
        dia_semana=DiaSemana.LUNES,
        hora_inicio=datetime(2029, 1, 1, 8, 0).time(),
        hora_fin=datetime(2029, 1, 1, 9, 0).time(),
        categoria=Categoria.ADULTOS, entrenador_id=entrenador.id,
    )
    db_session.add(horario)
    db_session.flush()
    db_session.add(Asistencia(
        fecha_entrenamiento=date(2029, 1, 1), estado=EstadoAsistencia.PRESENTE,
        persona_id=victima.id, horario_id=horario.id, entrenador_id=entrenador.id,
    ))
    db_session.commit()

    respuesta = client_ajeno.get(f"/api/v1/asistencias/persona/{victima.id}")
    assert respuesta.status_code == 403


def test_no_puede_leer_antecedentes_club_ajenos(client_ajeno, victima, db_session):
    db_session.add(AntecedentesClub(
        nivel_tecnico_alumno=NivelTecnicoAlumno.NIVEL_1,
        fecha_inicio_club=date(2029, 1, 1), persona_id=victima.id,
    ))
    db_session.commit()

    respuesta = client_ajeno.get(f"/api/v1/personas/{victima.id}/antecedentes-club")
    assert respuesta.status_code == 403


def test_no_puede_leer_horarios_de_otro_alumno(client_ajeno, victima):
    """Los horarios de un alumno dicen dónde está y a qué hora."""
    respuesta = client_ajeno.get(f"/api/v1/asistencias/alumnos/{victima.id}/horarios")
    assert respuesta.status_code == 403


# --- Contraparte positiva: el criterio no debe romper los accesos legítimos ---

def test_el_propio_duenio_si_lee_su_persona(db_session, victima):
    def _sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "victima@cataclub.test", "persona_id": victima.id, "roles": ["ALUMNO"],
    }
    with TestClient(app) as c:
        respuesta = c.get(f"/api/v1/personas/{victima.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 200


def test_el_representante_si_lee_a_su_representado(db_session):
    representante = Persona(
        nombres="Madre", apellidos="Tutora", cedula="1710034070",
        fecha_nacimiento=date(1980, 1, 1), telefono="0991110000",
    )
    db_session.add(representante)
    db_session.flush()
    hijo = Persona(
        nombres="Hijo", apellidos="Tutorado", cedula="1710034071",
        fecha_nacimiento=date(2015, 1, 1), telefono="0991110001",
        representante_id=representante.id,
    )
    db_session.add(hijo)
    db_session.commit()
    db_session.refresh(hijo)

    def _sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "madre@cataclub.test", "persona_id": representante.id,
        "roles": ["REPRESENTANTE"],
    }
    with TestClient(app) as c:
        respuesta = c.get(f"/api/v1/personas/{hijo.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 200


def test_el_administrador_si_lee_cualquier_persona(client, victima):
    """`client` está autenticado como ADMINISTRADOR + ENTRENADOR."""
    respuesta = client.get(f"/api/v1/personas/{victima.id}")
    assert respuesta.status_code == 200


# --- Portal del alumno: el vínculo de representación, en ambos sentidos -----
# `frontend/src/app/api/student/route.ts` arma el portal con el token del
# propio alumno y, si la persona tiene representante, pide TAMBIÉN la ficha
# del tutor para mostrar su nombre. Ese acceso va en sentido inverso al
# habitual (el representado leyendo a su representante) y debe seguir
# funcionando. Lo que NO debe habilitar es el resto de los datos del tutor.

@pytest.fixture()
def familia(db_session):
    """Representante + hijo menor, cada uno con su propio persona_id."""
    representante = Persona(
        nombres="Madre", apellidos="Tutora", cedula="1710034080",
        fecha_nacimiento=date(1980, 1, 1), telefono="0991110000",
    )
    db_session.add(representante)
    db_session.flush()
    hijo = Persona(
        nombres="Hijo", apellidos="Tutorado", cedula="1710034081",
        fecha_nacimiento=date(2015, 1, 1), telefono="0991110001",
        representante_id=representante.id,
    )
    db_session.add(hijo)
    db_session.commit()
    db_session.refresh(representante)
    db_session.refresh(hijo)
    return representante, hijo


def _client_como(db_session, persona_id, roles):
    def _sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "portal@cataclub.test", "persona_id": persona_id, "roles": roles,
    }
    return TestClient(app)


def test_el_representado_si_lee_la_ficha_de_su_representante(db_session, familia):
    representante, hijo = familia
    with _client_como(db_session, hijo.id, ["ALUMNO"]) as c:
        respuesta = c.get(f"/api/v1/personas/{representante.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 200
    assert respuesta.json()["nombres"] == "Madre"


def test_el_representado_no_lee_la_asistencia_de_su_representante(db_session, familia):
    """El sentido inverso se abre solo para la ficha, no para todo lo demás."""
    representante, hijo = familia
    with _client_como(db_session, hijo.id, ["ALUMNO"]) as c:
        respuesta = c.get(f"/api/v1/asistencias/persona/{representante.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 403


def test_el_representado_no_lee_los_horarios_de_su_representante(db_session, familia):
    representante, hijo = familia
    with _client_como(db_session, hijo.id, ["ALUMNO"]) as c:
        respuesta = c.get(f"/api/v1/asistencias/alumnos/{representante.id}/horarios")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 403


def test_el_representante_si_lee_la_asistencia_de_su_representado(db_session, familia):
    """El sentido habitual del vínculo: el tutor sí ve a su representado."""
    representante, hijo = familia
    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.get(f"/api/v1/asistencias/persona/{hijo.id}")
    app.dependency_overrides.clear()
    assert respuesta.status_code == 200
