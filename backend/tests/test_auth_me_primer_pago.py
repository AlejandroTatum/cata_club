"""Candado del campo `primerPago` en `GET /auth/me` (#1228).

Antes de este cambio la pantalla de activación (screen B) tenía una sola
copia para tres situaciones distintas: primer pago en revisión, primer pago
rechazado, o ningún pago todavía. `GestorAutenticacion.primer_pago_gate`
expone el hecho que faltaba; estos tests cubren su armado en el DTO real de
`/auth/me`, sin mockear la consulta.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago, TipoRol
from app.dominio.modelos import Membresia, Pago
from tests.test_auth_activation import _crear_usuario, _token


def _registrar_pago(db_session, *, membresia_id, persona_id, estado_pago, fecha_registro, motivo_rechazo=None):
    pago = Pago(
        monto=Decimal("25.00"),
        estado_pago=estado_pago,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_registro=fecha_registro,
        fecha_inicio=date(2026, 1, 1),
        fecha_fin=date(2026, 1, 31),
        persona_id=persona_id,
        membresia_id=membresia_id,
        motivo_rechazo=motivo_rechazo,
    )
    db_session.add(pago)
    db_session.commit()
    return pago


def _obtener_me(client_sin_token, usuario):
    respuesta = client_sin_token.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {_token(usuario)}"},
    )
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def test_primer_pago_pendiente_de_validacion(client_sin_token, db_session):
    usuario = _crear_usuario(
        db_session, correo="pago-pendiente@cataclub.test", correo_verificado=True,
        estado_membresia=EstadoMembresia.INACTIVA,
    )
    membresia = db_session.query(Membresia).filter_by(persona_id=usuario.persona_id).one()
    _registrar_pago(
        db_session, membresia_id=membresia.id, persona_id=usuario.persona_id,
        estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        fecha_registro=datetime.now(timezone.utc),
    )

    body = _obtener_me(client_sin_token, usuario)
    assert body["activacionCompleta"] is False
    assert body["primerPago"] == {"estado": "PENDIENTE_VALIDACION", "motivoRechazo": None}


def test_primer_pago_rechazado_con_motivo(client_sin_token, db_session):
    usuario = _crear_usuario(
        db_session, correo="pago-rechazado@cataclub.test", correo_verificado=True,
        estado_membresia=EstadoMembresia.INACTIVA,
    )
    membresia = db_session.query(Membresia).filter_by(persona_id=usuario.persona_id).one()
    _registrar_pago(
        db_session, membresia_id=membresia.id, persona_id=usuario.persona_id,
        estado_pago=EstadoPago.RECHAZADO,
        fecha_registro=datetime.now(timezone.utc),
        motivo_rechazo="El voucher no corresponde a la cuenta del club",
    )

    body = _obtener_me(client_sin_token, usuario)
    assert body["activacionCompleta"] is False
    assert body["primerPago"] == {
        "estado": "RECHAZADO",
        "motivoRechazo": "El voucher no corresponde a la cuenta del club",
    }


def test_primer_pago_es_el_mas_reciente_por_fecha_de_registro(client_sin_token, db_session):
    """Un rechazo viejo seguido de un pago nuevo en revisión: el visitante
    debe ver el estado ACTUAL, no el primero que se registró."""
    usuario = _crear_usuario(
        db_session, correo="pago-mas-reciente@cataclub.test", correo_verificado=True,
        estado_membresia=EstadoMembresia.INACTIVA,
    )
    membresia = db_session.query(Membresia).filter_by(persona_id=usuario.persona_id).one()
    ahora = datetime.now(timezone.utc)
    _registrar_pago(
        db_session, membresia_id=membresia.id, persona_id=usuario.persona_id,
        estado_pago=EstadoPago.RECHAZADO, fecha_registro=ahora - timedelta(days=5),
        motivo_rechazo="Comprobante ilegible",
    )
    _registrar_pago(
        db_session, membresia_id=membresia.id, persona_id=usuario.persona_id,
        estado_pago=EstadoPago.PENDIENTE_VALIDACION, fecha_registro=ahora,
    )

    body = _obtener_me(client_sin_token, usuario)
    assert body["primerPago"] == {"estado": "PENDIENTE_VALIDACION", "motivoRechazo": None}


def test_sin_ningun_pago_primer_pago_es_null(client_sin_token, db_session):
    usuario = _crear_usuario(
        db_session, correo="sin-pago@cataclub.test", correo_verificado=False,
    )
    body = _obtener_me(client_sin_token, usuario)
    assert body["activacionCompleta"] is False
    assert body["primerPago"] is None


def test_pago_aprobado_no_tiene_primer_pago_pendiente(client_sin_token, db_session):
    """El gate ya está pasado por `alta_presencial_completada`; un pago
    APROBADO no debe disparar ninguna de las dos copias nuevas."""
    usuario = _crear_usuario(
        db_session, correo="pago-aprobado@cataclub.test", correo_verificado=True,
        estado_membresia=EstadoMembresia.ACTIVA,
    )
    membresia = db_session.query(Membresia).filter_by(persona_id=usuario.persona_id).one()
    _registrar_pago(
        db_session, membresia_id=membresia.id, persona_id=usuario.persona_id,
        estado_pago=EstadoPago.APROBADO, fecha_registro=datetime.now(timezone.utc),
    )

    body = _obtener_me(client_sin_token, usuario)
    assert body["activacionCompleta"] is True
    assert body["primerPago"] is None


def test_admin_nunca_tiene_primer_pago(client_sin_token, db_session):
    usuario = _crear_usuario(
        db_session, correo="admin-primer-pago@cataclub.test", correo_verificado=False,
        rol=TipoRol.ADMINISTRADOR,
    )
    body = _obtener_me(client_sin_token, usuario)
    assert body["activacionCompleta"] is True
    assert body["primerPago"] is None
