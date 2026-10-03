from decimal import Decimal

import pytest

from app.soporte_transversal.formato import formatear_monto_usd


@pytest.mark.parametrize(("monto", "esperado"), [
    (Decimal("40"), "$40,00"),
    (Decimal("40.5"), "$40,50"),
    (Decimal("1000.00"), "$1.000,00"),
    (Decimal("0.07"), "$0,07"),
])
def test_formatea_monto_con_coma_decimal(monto, esperado):
    assert formatear_monto_usd(monto) == esperado
