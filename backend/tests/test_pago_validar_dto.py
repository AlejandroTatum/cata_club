"""ADM-07: `PagoValidarDTO` solo admite las dos resoluciones posibles."""
import pytest
from pydantic import ValidationError

from app.dominio.enums import EstadoPago
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoValidarDTO


def test_validar_acepta_aprobado_y_rechazado():
    assert PagoValidarDTO(estado_pago=EstadoPago.APROBADO).estado_pago == EstadoPago.APROBADO
    rechazo = PagoValidarDTO(estado_pago=EstadoPago.RECHAZADO, motivo_rechazo="sin fondos")
    assert rechazo.estado_pago == EstadoPago.RECHAZADO


def test_validar_rechaza_pendiente_validacion():
    with pytest.raises(ValidationError, match="aprobado o rechazado"):
        PagoValidarDTO(estado_pago=EstadoPago.PENDIENTE_VALIDACION)

