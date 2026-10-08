"""
Cola de salida genérica de correos (issue #1710).

El 2026-10-08 el tope diario de correos se agotó y los correos que salían
directo por SMTP -- "Pago aprobado", "Deuda regularizada" -- se perdieron:
`enviar_correo` los omitía y nadie los reintentaba. Los enlaces de
verificación, que van por una cola, solo se difirieron al día siguiente.

Ahora esos correos se ENCOLAN ya armados en `correo_outbox` dentro de la
transacción de negocio y los entrega el despachador, con la misma mecánica que
las otras colas: lease, backoff, `AGOTADO` y diferimiento por cupo.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from email.header import decode_header, make_header
from unittest.mock import MagicMock, patch

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.modelos import ContadorCorreoDiario, CorreoOutbox, Pago, Usuario
from app.infraestructura import notificaciones_servicio as notificaciones_mod
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.plantillas_correo import ID_CONTENIDO_ESCUDO
from app.infraestructura.repositorios import outbox_cupo
from app.infraestructura.tareas import celery_app as celery_app_mod
from app.infraestructura.tareas import correo_outbox_tareas
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoValidarDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from app.soporte_transversal.configuracion import settings
from tests import arnes_outbox as arnes
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

CORREO_TITULAR = "titular.outbox@cataclub.test"


@pytest.fixture()
def cola(db_session, monkeypatch):
    arnes.configurar_smtp(monkeypatch)
    with arnes.sesion_inyectada_en(notificaciones_mod, db_session, monkeypatch):
        with arnes.sesion_inyectada_en(correo_outbox_tareas, db_session, monkeypatch):
            arnes.celery_en_proceso(correo_outbox_tareas, monkeypatch)
            db_session.query(ContadorCorreoDiario).delete()
            db_session.commit()
            yield db_session


@pytest.fixture()
def smtp():
    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()
    ) as smtp_cls:
        yield smtp_cls


def _pago_pendiente(db_session):
    admin = crear_persona_orm(db_session, cedula_valida(1710), telefono="0990001710")
    titular = crear_persona_orm(
        db_session, cedula_valida(1711), nombres="Ana", apellidos="Outbox",
    )
    db_session.add(Usuario(correo=CORREO_TITULAR, contrasenia="hash", persona_id=titular.id))
    db_session.flush()
    tipo = crear_tipo_membresia_orm(db_session, categoria="Adultos", precio=Decimal("30.00"))
    membresia = crear_membresia_orm(db_session, titular, tipo, EstadoMembresia.INACTIVA)
    pago = Pago(
        monto=Decimal("30.00"), estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.EFECTIVO, fecha_inicio=date(2026, 8, 1),
        fecha_fin=date(2026, 8, 31), persona_id=titular.id, membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return admin, pago


def _filas(db_session) -> list[CorreoOutbox]:
    db_session.expire_all()
    return db_session.query(CorreoOutbox).order_by(CorreoOutbox.id).all()


def _agotar_cupo_de_hoy(db_session):
    db_session.add(ContadorCorreoDiario(
        fecha=datetime.now(timezone.utc).date(), enviados=settings.limite_correos_diario,
    ))
    db_session.commit()


def _asunto(mensaje) -> str:
    return str(make_header(decode_header(mensaje["Subject"])))


def test_validar_pago_encola_el_correo_en_vez_de_mandarlo_en_la_peticion(cola, smtp):
    admin, pago = _pago_pendiente(cola)

    PagoServicio(cola).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    assert arnes.envios(smtp) == [], "la petición ya no abre SMTP"
    [fila] = _filas(cola)
    assert fila.status == "PENDIENTE"
    assert fila.destinatario == CORREO_TITULAR
    assert fila.asunto == "Cata Club | Pago aprobado"
    usuario = cola.query(Usuario).filter_by(correo=CORREO_TITULAR).one()
    assert fila.usuario_id == usuario.id


def test_el_despachador_entrega_el_correo_encolado_con_el_mismo_contenido(cola, smtp):
    admin, pago = _pago_pendiente(cola)
    PagoServicio(cola).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    resultado = correo_outbox_tareas.despachar_correos_pendientes()

    assert resultado["reclamadas"] == 1
    _remitente, destinatario, mensaje = arnes.mensaje_enviado(smtp)
    assert destinatario == CORREO_TITULAR
    assert _asunto(mensaje) == "Cata Club | Pago aprobado"
    assert "Hola Ana," in arnes.texto_plano(mensaje)
    tipos = [parte.get_content_type() for parte in mensaje.walk()]
    assert "text/html" in tipos and "image/png" in tipos, "el escudo inline viaja igual"
    html = next(p for p in mensaje.walk() if p.get_content_type() == "text/html")
    assert f"cid:{ID_CONTENIDO_ESCUDO}" in html.get_payload(decode=True).decode("utf-8")
    [fila] = _filas(cola)
    assert fila.status == "ENVIADO" and fila.sent_at is not None


def test_con_el_cupo_agotado_el_correo_de_pago_se_difiere_y_no_se_pierde(
    cola, smtp, monkeypatch
):
    monkeypatch.setattr(settings, "limite_correos_diario", 1)
    admin, pago = _pago_pendiente(cola)
    PagoServicio(cola).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )
    _agotar_cupo_de_hoy(cola)

    correo_outbox_tareas.despachar_correos_pendientes()

    assert arnes.envios(smtp) == []
    [fila] = _filas(cola)
    assert fila.status == "PENDIENTE"
    assert fila.attempts == 0
    assert fila.next_attempt_at >= outbox_cupo.inicio_del_dia_siguiente_utc()
    assert outbox_cupo.contar_en_espera_por_cupo(cola) == 1

    # Día siguiente: el contador arranca de cero y la fila sale.
    cola.query(ContadorCorreoDiario).delete()
    fila.next_attempt_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    cola.commit()
    correo_outbox_tareas.despachar_correos_pendientes()

    assert len(arnes.envios(smtp)) == 1
    assert _filas(cola)[0].status == "ENVIADO"


def test_una_transaccion_revertida_no_encola_nada(cola, smtp):
    _pago_pendiente(cola)

    ServicioNotificaciones(encolar_en=cola).enviar_correo(
        destinatario=CORREO_TITULAR, asunto="Cata Club | Prueba", cuerpo_texto="texto",
    )
    cola.rollback()

    assert _filas(cola) == []
    assert arnes.envios(smtp) == []


def test_sin_smtp_configurado_encolar_no_falla_y_la_fila_espera(cola, smtp, monkeypatch):
    """Encolar no depende del proveedor: la fila espera aunque SMTP falte."""
    monkeypatch.setattr(settings, "smtp_host", "")
    admin, pago = _pago_pendiente(cola)

    resultado = PagoServicio(cola).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=admin.id,
    )

    assert resultado.estado_pago == EstadoPago.APROBADO
    assert [f.status for f in _filas(cola)] == ["PENDIENTE"]


def test_el_beat_despacha_y_limpia_la_cola_de_correos():
    tareas = {
        v["task"] for v in celery_app_mod.celery_app.conf.beat_schedule.values()
    }
    assert (
        "app.infraestructura.tareas.correo_outbox_tareas.despachar_correos_pendientes"
        in tareas
    )
    assert (
        "app.infraestructura.tareas.correo_outbox_tareas.limpiar_correos_vencidos"
        in tareas
    )
