"""
Paridad de la regla de descuento entre el backend y el helper del frontend
(`descuentoExcedeTarifa`, `frontend/src/lib/__tests__/discount-parity.test.ts`).

Las dos mitades comparten la misma tabla de casos (copiada a mano en cada
archivo: no hay un fixture común entre pytest y vitest) y la misma base: el
`monto_aplicado` de la membresía (`membresia.monto` en el frontend). Para
tarifas SEMANAL/DIARIA `monto_aplicado` es el precio del período, y un pago
de un período tiene `monto_base == monto_aplicado`.
"""
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Descuento
from app.servicios_negocio.beneficio_servicio import BeneficioServicio
from app.servicios_negocio.membresia_pago_servicio import PagoServicio

# (tarifa, porcentaje, monto, valor esperado, excede la tarifa)
CASOS = [
    ("mensual 100%", "10.00", "100", None, "10.00", False),
    ("mensual 50%", "25.00", "50", None, "12.50", False),
    ("mensual 100% con centavos", "19.99", "100", None, "19.99", False),
    ("porcentaje fraccionario", "0.10", "33.33", None, "0.03", False),
    ("semanal monto igual a la tarifa", "7.00", None, "7.00", "7.00", False),
    ("semanal monto 1 centavo por encima", "7.00", None, "7.01", "7.01", True),
    ("diaria monto por encima", "2.50", None, "2.51", "2.51", True),
    ("mensual monto menor", "25.00", None, "10.00", "10.00", False),
]


def _descuento(porcentaje, monto) -> Descuento:
    return Descuento(
        nombre="paridad",
        porcentaje=Decimal(porcentaje) if porcentaje is not None else None,
        monto=Decimal(monto) if monto is not None else None,
    )


@pytest.mark.parametrize("nombre,tarifa,porcentaje,monto,valor,excede", CASOS)
def test_valor_potencial_y_tope_coinciden_con_el_frontend(
    nombre, tarifa, porcentaje, monto, valor, excede,
):
    descuento = _descuento(porcentaje, monto)
    tarifa_dec = Decimal(tarifa)

    calculado = BeneficioServicio._valor_potencial(descuento, tarifa_dec)

    assert calculado == Decimal(valor)
    assert (calculado > tarifa_dec) is excede


@pytest.mark.parametrize("nombre,tarifa,porcentaje,monto,valor,excede", CASOS)
def test_el_pago_congela_el_mismo_valor_contra_el_monto_base(
    nombre, tarifa, porcentaje, monto, valor, excede,
):
    descuento = _descuento(porcentaje, monto)
    descuento.id = 1
    servicio = object.__new__(PagoServicio)
    servicio.repo_asignacion = SimpleNamespace(
        obtener_activa_por_persona=lambda _pid: SimpleNamespace(
            id=1, descuento_id=1, asignado_por_persona_id=7,
        ),
    )
    servicio.repo_descuento = SimpleNamespace(obtener_por_id=lambda _id: descuento)
    monto_base = Decimal(tarifa)  # un período: monto_base == monto_aplicado

    if excede:
        with pytest.raises(OperacionInvalida):
            servicio._congelar_beneficio_activo(1, monto_base)
        return

    congelado, final = servicio._congelar_beneficio_activo(1, monto_base)
    assert congelado.valor_aplicado == Decimal(valor)
    assert final == monto_base - Decimal(valor)
