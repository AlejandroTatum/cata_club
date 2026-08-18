"""Candados del snapshot de tarifa congelado en `pago` (issue #400).

Qué congela un pago y por qué: hoy el monto mensual vive solo en
`membresia.monto_aplicado`, que es mutable. Cambiar la tarifa del catálogo
reescribiría de hecho cuántos meses compró un pago viejo, porque los meses se
derivan dividiendo por ese valor VIGENTE. #400 exige que cada pago congele su
propia tarifa, sus meses y su monto base, para que el historial no dependa de
un número que alguien puede editar mañana.

Las tres columnas nacen NULLABLE a propósito. Los pagos históricos NO se
rellenan: la tarifa que regía cuando se cobraron es justamente lo que nadie
registró, y `scripts/inventario_anomalias_pagos.py` (A5) mide cuántas filas
quedan sin poder reconstruirse. Inventar ese número sería exactamente la
"corrección automática de plata ambigua" que #400 prohíbe.

Lo que sí se exige es que el snapshot sea COMPLETO o AUSENTE, nunca a medias:
un pago con tarifa pero sin meses es un hecho histórico incompleto, que es
peor que no tener snapshot, porque miente con forma de dato bueno.
"""
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago
from tests.fabricas_pagos import (
    crear_membresia_orm,
    crear_pago_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
)

SNAPSHOT_COMPLETO = {
    "tarifa_mensual_aplicada": Decimal("30.00"),
    "meses_comprados": 3,
    "monto_base": Decimal("90.00"),
}


@pytest.fixture
def membresia(db_session):
    persona = crear_persona_orm(db_session, cedula_valida(701))
    tipo = crear_tipo_membresia_orm(db_session, precio=Decimal("30.00"))
    return persona, crear_membresia_orm(
        db_session, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
    )


def test_un_pago_sin_snapshot_sigue_siendo_valido(db_session, membresia):
    """Compatibilidad hacia atrás, y no es un detalle: mientras dure la
    cadena de #400 el código viejo sigue insertando pagos sin snapshot. Si
    estas columnas fueran NOT NULL, esta migración partiría la aplicación en
    el momento de aplicarse."""
    persona, memb = membresia
    pago = crear_pago_orm(db_session, persona, memb, EstadoPago.APROBADO)

    db_session.flush()

    assert pago.tarifa_mensual_aplicada is None
    assert pago.meses_comprados is None
    assert pago.monto_base is None


def test_un_pago_acepta_el_snapshot_completo(db_session, membresia):
    persona, memb = membresia
    pago = crear_pago_orm(db_session, persona, memb, EstadoPago.APROBADO,
                          monto=Decimal("90.00"))
    for campo, valor in SNAPSHOT_COMPLETO.items():
        setattr(pago, campo, valor)

    db_session.flush()

    assert pago.tarifa_mensual_aplicada == Decimal("30.00")
    assert pago.meses_comprados == 3
    assert pago.monto_base == Decimal("90.00")


@pytest.mark.parametrize("campo_ausente", sorted(SNAPSHOT_COMPLETO))
def test_un_snapshot_parcial_es_rechazado(db_session, membresia, campo_ausente):
    """Todo o nada. Un snapshot a medias tiene forma de dato bueno y no lo
    es: quien lo lea creerá que el pago quedó congelado cuando le falta la
    mitad de la cuenta."""
    persona, memb = membresia
    pago = crear_pago_orm(db_session, persona, memb, EstadoPago.APROBADO,
                          monto=Decimal("90.00"))
    for campo, valor in SNAPSHOT_COMPLETO.items():
        if campo != campo_ausente:
            setattr(pago, campo, valor)

    with pytest.raises(IntegrityError, match="ck_pago_snapshot_completo_o_ausente"):
        db_session.flush()


@pytest.mark.parametrize("meses", [0, -1])
def test_meses_comprados_debe_ser_positivo(db_session, membresia, meses):
    """Un pago que compra cero meses no compra nada; uno que compra meses
    negativos devuelve cobertura, y eso no existe en este dominio."""
    persona, memb = membresia
    pago = crear_pago_orm(db_session, persona, memb, EstadoPago.APROBADO,
                          monto=Decimal("90.00"))
    pago.tarifa_mensual_aplicada = Decimal("30.00")
    pago.monto_base = Decimal("90.00")
    pago.meses_comprados = meses

    with pytest.raises(IntegrityError, match="ck_pago_meses_comprados_positivo"):
        db_session.flush()
