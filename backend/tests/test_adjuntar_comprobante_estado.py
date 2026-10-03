"""API-01: el comprobante oficial solo existe para un pago APROBADO y con URL web."""
import pytest
from pydantic import ValidationError

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago
from app.dominio.excepciones import OperacionInvalida
from app.servicios_negocio.dtos.membresia_pago_schemas import ComprobantePagoCreateDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_pago_orm, crear_persona_orm, crear_tipo_membresia_orm,
)

URL_VALIDA = "https://res.cloudinary.com/demo/comprobante.pdf"


def _pago(db_session, estado: EstadoPago):
    persona = crear_persona_orm(db_session, cedula_valida(310))
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, persona, tipo, EstadoMembresia.ACTIVA)
    pago = crear_pago_orm(db_session, persona, membresia, estado)
    db_session.flush()
    return pago


@pytest.mark.parametrize("estado", [EstadoPago.PENDIENTE_VALIDACION, EstadoPago.RECHAZADO])
def test_adjuntar_comprobante_rechaza_pago_no_aprobado(db_session, estado):
    pago = _pago(db_session, estado)
    datos = ComprobantePagoCreateDTO(archivo_url=URL_VALIDA, formato_archivo="pdf")

    with pytest.raises(OperacionInvalida, match="pago aprobado"):
        PagoServicio(db_session).adjuntar_comprobante(pago.id, datos)


def test_adjuntar_comprobante_acepta_pago_aprobado(db_session):
    pago = _pago(db_session, EstadoPago.APROBADO)
    datos = ComprobantePagoCreateDTO(archivo_url=URL_VALIDA, formato_archivo="pdf")

    comprobante = PagoServicio(db_session).adjuntar_comprobante(pago.id, datos)

    assert comprobante.pago_id == pago.id


@pytest.mark.parametrize("url", ["javascript:alert(1)", "data:text/html,x", "ftp://x.example/a.pdf", "http://x.example/a.pdf", "https://", "x.pdf"])
def test_comprobante_dto_rechaza_urls_que_no_son_web(url):
    with pytest.raises(ValidationError):
        ComprobantePagoCreateDTO(archivo_url=url, formato_archivo="pdf")
