"""ADM-06 (QA3): el precio de un tipo de membresía va de 1.00 a 1000.00 con
a lo sumo 2 decimales, al crear y al editar. Sin tope, `1e30` llegaba a la
columna NUMERIC y terminaba en un 500."""
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.servicios_negocio.dtos.membresia_pago_schemas import (
    TipoMembresiaCreateDTO,
    TipoMembresiaUpdateDTO,
)


def _crear(precio):
    return TipoMembresiaCreateDTO(categoria="Adultos", precio=precio, modalidad="MENSUAL")


@pytest.mark.parametrize("precio", ["1", "1.00", "30.50", "999.99", "1000", "1000.00"])
def test_precios_en_rango_se_aceptan(precio):
    assert _crear(precio).precio == Decimal(precio)
    assert TipoMembresiaUpdateDTO(precio=precio).precio == Decimal(precio)


@pytest.mark.parametrize("precio", [
    "0", "0.99", "-5", "1000.01", "1e30", "99999999999", "10.123", "1.001",
])
def test_precios_fuera_de_rango_o_con_mas_de_dos_decimales_se_rechazan(precio):
    with pytest.raises(ValidationError):
        _crear(precio)
    with pytest.raises(ValidationError):
        TipoMembresiaUpdateDTO(precio=precio)
