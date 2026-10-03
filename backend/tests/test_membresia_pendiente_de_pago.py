"""
QA3 ADM-08: crear una membresía para una persona que ya tiene una INACTIVA
con un pago pendiente se rechaza, con el id de la existente para que la UI la
enlace. Sin pago pendiente (INACTIVA a secas) la creación sigue permitida.
"""
from app.dominio.enums import EstadoMembresia, EstadoPago
from tests.fabricas_pagos import (
    crear_membresia_orm,
    crear_pago_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
)

MENSAJE = "Ya tiene una membresía pendiente de pago."


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


def test_membresia_inactiva_sin_pago_pendiente_permite_crear(client, db_session):
    persona = crear_persona_orm(db_session, "1710034065")
    tipo = crear_tipo_membresia_orm(db_session)
    crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    db_session.flush()

    assert _crear(client, persona.id, tipo.id).status_code == 201


def test_pago_rechazado_no_cuenta_como_pendiente(client, db_session):
    persona = crear_persona_orm(db_session, "1710034065")
    tipo = crear_tipo_membresia_orm(db_session)
    existente = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.INACTIVA)
    crear_pago_orm(db_session, persona, existente, EstadoPago.RECHAZADO)
    db_session.flush()

    assert _crear(client, persona.id, tipo.id).status_code == 201
