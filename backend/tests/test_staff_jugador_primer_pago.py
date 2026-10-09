"""Staff que también juega: su PRIMER pago, vía la API pública.

Una cuenta ADMINISTRADOR/ENTRENADOR cuya membresía propia todavía está INACTIVA
(creada por un admin, sin ningún pago aprobado) registra su primer pago por el
mismo endpoint que cualquier socio (`POST /membresias/pagos`, que autoriza por
titular, no por rol). El pago queda PENDIENTE_VALIDACION y lo revisa un admin
por la cola normal -- nunca el propio titular: aprobar o rechazar el pago de la
propia membresía se rechaza en el servicio.
"""
import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago
from app.dominio.modelos import Membresia, Pago
from app.servicios_negocio.membresia_pago_servicio import MENSAJE_VALIDACION_PAGO_PROPIO
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm,
)
from tests.test_staff_jugador_portal import API, ROLES_STAFF, _ajena, _como

APROBAR = {
    "estado_pago": "APROBADO",
    "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
}


def _staff_inactivo(db_session, base):
    persona = crear_persona_orm(db_session, cedula_valida(base), nombres="Staff", apellidos="Nuevo")
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    db_session.commit()
    return persona, membresia


def _pagar(client, persona, membresia):
    return client.post(f"{API}/membresias/pagos", json={
        "meses": 1, "tipo_pago": "TRANSFERENCIA",
        "persona_id": persona.id, "membresia_id": membresia.id,
    })


@pytest.mark.parametrize("rol", ROLES_STAFF)
def test_staff_con_membresia_inactiva_registra_su_primer_pago_por_validar(client, db_session, rol):
    persona, membresia = _staff_inactivo(db_session, 9200)
    _como(persona.id, rol)

    respuesta = _pagar(client, persona, membresia)

    assert respuesta.status_code == 201, respuesta.text
    pago = db_session.query(Pago).filter(Pago.persona_id == persona.id).one()
    assert pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION
    assert pago.membresia_id == membresia.id
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.INACTIVA


def test_staff_con_membresia_inactiva_no_paga_por_otra_persona(client, db_session):
    propia, _ = _staff_inactivo(db_session, 9210)
    ajena, membresia_ajena = _ajena(db_session, 9211)
    # Un ADMINISTRADOR registra pagos de terceros desde Miembros; el
    # ENTRENADOR no, y es el caso que protege "lo suyo y nada más".
    _como(propia.id, "ENTRENADOR")
    respuesta = _pagar(client, ajena, membresia_ajena)

    assert respuesta.status_code == 403
    assert db_session.query(Pago).count() == 0


def test_admin_no_valida_el_pago_de_su_propia_membresia(client, db_session):
    persona, membresia = _staff_inactivo(db_session, 9220)
    _como(persona.id, "ADMINISTRADOR")
    pago_id = _pagar(client, persona, membresia).json()["id"]

    aprobar = client.patch(f"{API}/membresias/pagos/{pago_id}/validar", json=APROBAR)
    rechazar = client.patch(
        f"{API}/membresias/pagos/{pago_id}/validar",
        json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Me equivoqué"},
    )

    for respuesta in (aprobar, rechazar):
        assert respuesta.status_code == 400, respuesta.text
        assert MENSAJE_VALIDACION_PAGO_PROPIO in respuesta.text
    db_session.expire_all()
    pago = db_session.get(Pago, pago_id)
    assert pago.estado_pago == EstadoPago.PENDIENTE_VALIDACION
    assert pago.validado_por_persona_id is None
    assert db_session.get(Membresia, membresia.id).estado == EstadoMembresia.INACTIVA


def test_otro_admin_valida_el_primer_pago_y_la_membresia_se_activa(client, db_session):
    persona, membresia = _staff_inactivo(db_session, 9230)
    otro_admin = crear_persona_orm(db_session, cedula_valida(9231), nombres="Otro", apellidos="Admin")
    db_session.commit()
    _como(persona.id, "ENTRENADOR")
    pago_id = _pagar(client, persona, membresia).json()["id"]

    _como(otro_admin.id, "ADMINISTRADOR")
    respuesta = client.patch(f"{API}/membresias/pagos/{pago_id}/validar", json=APROBAR)

    assert respuesta.status_code == 200, respuesta.text
    db_session.expire_all()
    pago = db_session.get(Pago, pago_id)
    assert pago.estado_pago == EstadoPago.APROBADO
    assert pago.validado_por_persona_id == otro_admin.id
    assert db_session.get(Membresia, membresia.id).estado == EstadoMembresia.ACTIVA


def test_admin_sigue_validando_pagos_ajenos(client, db_session):
    """La cola de revisión no cambia: el guard solo mira a la persona dueña."""
    admin = crear_persona_orm(db_session, cedula_valida(9240), nombres="Admin", apellidos="Revisor")
    persona, membresia = _staff_inactivo(db_session, 9241)
    _como(persona.id, "ENTRENADOR")
    pago_id = _pagar(client, persona, membresia).json()["id"]
    _como(admin.id, "ADMINISTRADOR")

    assert client.patch(f"{API}/membresias/pagos/{pago_id}/validar", json=APROBAR).status_code == 200
