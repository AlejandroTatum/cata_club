"""Corrección de pagos según la periodicidad de la tarifa (follow-up de #1699).

`corregir_pago` valida que `fecha_fin` sea la cobertura que compran
`meses_comprados` períodos desde `fecha_inicio`, con la aritmética de la
periodicidad de la tarifa del pago: 7 días por período para SEMANAL, 1 día
para DIARIA y meses calendario para MENSUAL.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EfectoCoberturaCorreccion, EstadoMembresia, EstadoPago, TipoPago
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Pago
from app.dominio.periodicidad import PeriodicidadTarifa
from app.servicios_negocio.dtos.membresia_pago_schemas import CorreccionPagoDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio, _sumar_meses
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

INICIO = date(2027, 3, 1)
TARIFA = Decimal("8.00")


@pytest.fixture
def admin_id(db_session) -> int:
    return crear_persona_orm(db_session, cedula_valida(999)).id


def _pago_de(db_session, periodicidad: PeriodicidadTarifa, fin) -> Pago:
    persona = crear_persona_orm(db_session, cedula_valida(930))
    tipo = crear_tipo_membresia_orm(db_session, precio=TARIFA)
    tipo.periodicidad = periodicidad
    membresia = crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=TARIFA,
    )
    pago = Pago(
        monto=TARIFA, tarifa_mensual_aplicada=TARIFA, meses_comprados=1, monto_base=TARIFA,
        estado_pago=EstadoPago.APROBADO, tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=INICIO, fecha_fin=fin(INICIO),
        persona_id=persona.id, membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return pago


def _corregir(db_session, pago, admin_id, **campos):
    return PagoServicio(db_session).corregir_pago(
        pago.id, CorreccionPagoDTO(motivo="Fecha mal registrada", **campos),
        actor_persona_id=admin_id,
    )


CASOS = [
    pytest.param(PeriodicidadTarifa.SEMANAL, lambda d: d + timedelta(days=7), timedelta(days=7), id="semanal"),
    pytest.param(PeriodicidadTarifa.DIARIA, lambda d: d + timedelta(days=1), timedelta(days=1), id="diaria"),
    pytest.param(PeriodicidadTarifa.MENSUAL, lambda d: _sumar_meses(d, 1), None, id="mensual"),
]


@pytest.mark.parametrize(("periodicidad", "fin", "_paso"), CASOS)
def test_corregir_la_fecha_reancla_la_cobertura_con_la_aritmetica_de_la_tarifa(
    db_session, admin_id, periodicidad, fin, _paso,
):
    pago = _pago_de(db_session, periodicidad, fin)
    nuevo_inicio = INICIO + timedelta(days=10)

    corregido, correccion = _corregir(
        db_session, pago, admin_id, fecha_inicio=nuevo_inicio, fecha_fin=fin(nuevo_inicio),
    )

    assert corregido.fecha_inicio == nuevo_inicio
    assert corregido.fecha_fin == fin(nuevo_inicio)
    assert correccion.efecto_cobertura == EfectoCoberturaCorreccion.AMPLIADA


@pytest.mark.parametrize(
    ("periodicidad", "fin", "fin_incorrecto"),
    [
        pytest.param(PeriodicidadTarifa.SEMANAL, lambda d: d + timedelta(days=7), _sumar_meses, id="semanal"),
        pytest.param(PeriodicidadTarifa.DIARIA, lambda d: d + timedelta(days=1), _sumar_meses, id="diaria"),
    ],
)
def test_fecha_fin_con_aritmetica_mensual_se_rechaza_en_tarifas_semanal_y_diaria(
    db_session, admin_id, periodicidad, fin, fin_incorrecto,
):
    pago = _pago_de(db_session, periodicidad, fin)
    nuevo_inicio = INICIO + timedelta(days=10)

    with pytest.raises(OperacionInvalida, match="fecha de fin no coincide"):
        _corregir(
            db_session, pago, admin_id,
            fecha_inicio=nuevo_inicio, fecha_fin=fin_incorrecto(nuevo_inicio, 1),
        )

    db_session.refresh(pago)
    assert pago.fecha_inicio == INICIO


def test_mensual_rechaza_una_fecha_fin_de_siete_dias(db_session, admin_id):
    pago = _pago_de(db_session, PeriodicidadTarifa.MENSUAL, lambda d: _sumar_meses(d, 1))
    nuevo_inicio = INICIO + timedelta(days=10)

    with pytest.raises(OperacionInvalida, match="fecha de fin no coincide"):
        _corregir(
            db_session, pago, admin_id,
            fecha_inicio=nuevo_inicio, fecha_fin=nuevo_inicio + timedelta(days=7),
        )
