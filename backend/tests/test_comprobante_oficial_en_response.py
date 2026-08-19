"""Comprobante oficial expuesto en la respuesta del pago (issue #400,
criterio 8).

Antes de este fix, `PagoResponseDTO` no exponía ningún campo del PDF oficial
que el club genera al aprobar (`ComprobantePago`, ver
`comprobante_tareas.py`) -- solo `voucher_url`, que es la evidencia que SUBE
el alumno, no el comprobante oficial. Sin un campo dedicado, el frontend no
tenía ninguna vía de lectura/descarga del PDF ya generado.

`comprobante_oficial_url` se puebla desde `Pago.comprobante` (relación 1:1
con `ComprobantePago`) SOLO cuando esa fila existe -- por construcción, solo
existe si el pago fue APROBADO (`comprobante_tareas.py` aborta si no lo
está), así que no hace falta un chequeo de estado adicional acá."""
from datetime import date
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.modelos import ComprobantePago, Pago
from app.servicios_negocio.membresia_pago_servicio import PagoServicio, _sumar_meses
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

FECHA_INICIO = date(2027, 1, 1)


@pytest.fixture
def pago_aprobado(db_session):
    persona = crear_persona_orm(db_session, cedula_valida(910))
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    pago = Pago(
        monto=Decimal("30.00"),
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=FECHA_INICIO,
        fecha_fin=_sumar_meses(FECHA_INICIO, 1),
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return pago


def test_pago_sin_comprobante_devuelve_campo_nulo(db_session, pago_aprobado):
    dto = PagoServicio(db_session).pago_a_response_dto(pago_aprobado)
    assert dto.comprobante_oficial_url is None


def test_pago_con_comprobante_devuelve_url_firmada(db_session, pago_aprobado):
    comprobante = ComprobantePago(
        archivo_url="comprobante-pago-00000001",
        formato_archivo="pdf",
        pago_id=pago_aprobado.id,
    )
    db_session.add(comprobante)
    db_session.commit()
    db_session.refresh(pago_aprobado)

    dto = PagoServicio(db_session).pago_a_response_dto(pago_aprobado)

    assert dto.comprobante_oficial_url is not None
    # No es el `public_id` crudo tal cual: `resolver_url_entrega` lo tradujo
    # a una URL de entrega firmada -- mismo criterio que `voucher_url`.
    assert dto.comprobante_oficial_url != comprobante.archivo_url


def test_comprobante_oficial_via_api(client, db_session):
    persona = crear_persona_orm(db_session, cedula_valida(911))
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    pago = Pago(
        monto=Decimal("30.00"),
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=FECHA_INICIO,
        fecha_fin=_sumar_meses(FECHA_INICIO, 1),
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    db_session.add(ComprobantePago(
        archivo_url="comprobante-pago-00000002", formato_archivo="pdf", pago_id=pago.id,
    ))
    db_session.commit()

    resp = client.get(f"/api/v1/membresias/pagos/{pago.id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["comprobanteOficialUrl"] is not None
