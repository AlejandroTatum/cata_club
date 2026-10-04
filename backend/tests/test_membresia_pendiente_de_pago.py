"""
QA3 ADM-08: crear una membresía para una persona que ya tiene una INACTIVA
con un pago pendiente se rechaza, con el id de la existente para que la UI la
enlace. QA4 ADMA-05/FAM-01: una INACTIVA a secas (sin pago pendiente) también
bloquea la creación, con un mensaje que manda a registrar el pago en la existente.
"""
from app.dominio.enums import EstadoMembresia, EstadoPago
from tests.fabricas_pagos import (
    crear_membresia_orm,
    crear_pago_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
)

MENSAJE = "Ya tiene una membresía pendiente de pago."
MENSAJE_INACTIVA = (
    "Esta persona ya tiene una membresía inactiva. Registra el pago en esa "
    "membresía para activarla."
)


def _crear(client, persona_id, tipo_id):
    return client.post(
        "/api/v1/membresias/", json={"persona_id": persona_id, "tipo_membresia_id": tipo_id},
    )


def test_membresia_inactiva_con_pago_pendiente_rechaza_crear_otra_con_su_id(client, db_session):
    persona = crear_persona_orm(db_session, "1710034065")
    tipo = crear_tipo_membresia_orm(db_session)
    existente = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    crear_pago_orm(db_session, persona, existente, EstadoPago.PENDIENTE_VALIDACION)
    db_session.flush()

    resp = _crear(client, persona.id, tipo.id)

    assert resp.status_code == 400
    cuerpo = resp.json()
    assert cuerpo["detail"] == MENSAJE
    assert cuerpo["membresia_id"] == existente.id


def test_membresia_inactiva_sin_pago_pendiente_rechaza_crear_otra(client, db_session):
    persona = crear_persona_orm(db_session, "1710034065")
    tipo = crear_tipo_membresia_orm(db_session)
    existente = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    db_session.flush()

    resp = _crear(client, persona.id, tipo.id)

    assert resp.status_code == 400
    cuerpo = resp.json()
    assert cuerpo["detail"] == MENSAJE_INACTIVA
    assert cuerpo["membresia_id"] == existente.id


def test_pago_rechazado_no_cuenta_como_pendiente_pero_la_inactiva_bloquea(client, db_session):
    persona = crear_persona_orm(db_session, "1710034065")
    tipo = crear_tipo_membresia_orm(db_session)
    existente = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    crear_pago_orm(db_session, persona, existente, EstadoPago.RECHAZADO)
    db_session.flush()

    resp = _crear(client, persona.id, tipo.id)

    assert resp.status_code == 400
    assert resp.json()["detail"] == MENSAJE_INACTIVA


def test_persona_sin_membresia_inactiva_puede_crear(client, db_session):
    persona = crear_persona_orm(db_session, "1710034065")
    tipo = crear_tipo_membresia_orm(db_session)
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.VENCIDA)
    db_session.flush()

    assert _crear(client, persona.id, tipo.id).status_code == 201
