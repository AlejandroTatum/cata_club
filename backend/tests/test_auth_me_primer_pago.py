"""Candado del campo `primerPago` en `GET /auth/me` (#1228).

Antes de este cambio la pantalla de activación (screen B) tenía una sola
copia para tres situaciones distintas: primer pago en revisión, primer pago
rechazado, o ningún pago todavía. `GestorAutenticacion.primer_pago_gate`
expone el hecho que faltaba; estos tests cubren su armado en el DTO real de
`/auth/me`, sin mockear la consulta.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.dominio.enums import EstadoMembresia, EstadoPago, TipoModalidad, TipoPago, TipoRol
from app.dominio.modelos import Membresia, Pago, TipoMembresia
from app.seguridad.gestor_auth import GestorAutenticacion
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


# --- Corrección de #1236: elegir la membresía más reciente, no cualquiera --
#
# El esquema permite más de una membresía NO-operativa por persona (el índice
# único parcial `uq_membresia_activa_por_persona` solo cubre ACTIVA/
# SUSPENDIDA; `inventario_anomalias_membresias.py` documenta esta condición
# real como A4). Sin ORDER BY, la consulta podía devolver la VENCIDA vieja en
# vez de la INACTIVA nueva, y entonces `primer_pago` mostraba el pago
# APROBADO de la membresía equivocada en lugar del rechazo real más
# reciente.
#
# Llama a `primer_pago_gate` directo, no a través de `/auth/me`: una VENCIDA
# es uno de los estados "habilitantes" de `alta_presencial_completada` (junto
# a ACTIVA y SUSPENDIDA), así que ESTE fixture en particular ya tiene
# `activacion_completa=True` -- el router ni siquiera llamaría a
# `primer_pago_gate`. Lo que este test aísla es el ordenamiento de la
# consulta en sí, no el gate completo (ya cubierto por los tests de arriba).
def test_primer_pago_usa_la_membresia_mas_reciente_no_cualquiera(db_session):
    usuario = _crear_usuario(
        db_session, correo="doble-membresia@cataclub.test", correo_verificado=True,
        estado_membresia=None,
    )
    ahora = datetime.now(timezone.utc)
    plan_viejo = TipoMembresia(categoria="Mensual", precio=Decimal("25.00"), modalidad=TipoModalidad.MENSUAL)
    plan_nuevo = TipoMembresia(categoria="Mensual", precio=Decimal("25.00"), modalidad=TipoModalidad.MENSUAL)
    db_session.add_all([plan_viejo, plan_nuevo])
    db_session.flush()

    membresia_vieja = Membresia(
        estado=EstadoMembresia.VENCIDA, monto_aplicado=Decimal("25.00"),
        fecha_activacion=ahora - timedelta(days=200),
        persona_id=usuario.persona_id, tipo_membresia_id=plan_viejo.id,
    )
    db_session.add(membresia_vieja)
    db_session.commit()
    _registrar_pago(
        db_session, membresia_id=membresia_vieja.id, persona_id=usuario.persona_id,
        estado_pago=EstadoPago.APROBADO, fecha_registro=ahora - timedelta(days=200),
    )

    membresia_nueva = Membresia(
        estado=EstadoMembresia.INACTIVA, monto_aplicado=Decimal("25.00"),
        fecha_activacion=ahora,
        persona_id=usuario.persona_id, tipo_membresia_id=plan_nuevo.id,
    )
    db_session.add(membresia_nueva)
    db_session.commit()
    _registrar_pago(
        db_session, membresia_id=membresia_nueva.id, persona_id=usuario.persona_id,
        estado_pago=EstadoPago.RECHAZADO, fecha_registro=ahora,
        motivo_rechazo="Comprobante vencido",
    )

    resultado = GestorAutenticacion.primer_pago_gate(db_session, usuario.persona_id)
    assert resultado == {"estado": "RECHAZADO", "motivo_rechazo": "Comprobante vencido"}


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
