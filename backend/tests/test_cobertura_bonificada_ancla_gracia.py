"""Ancla de la cobertura bonificada con ventana de gracia (#1779).

Activar el beneficio dentro de la gracia de 3 días del bloqueo por impago
ancla el mes en el fin de la cobertura (sin hueco), igual que un pago mensual
(`ancla_del_pago`, #1768); pasada la gracia ancla en hoy.
"""
from datetime import timedelta
from decimal import Decimal

import pytest

from app.dominio.enums import EstadoPago, TipoPago
from app.dominio.modelos import CoberturaBonificada, Membresia, Pago, Persona
from app.servicios_negocio.membresia_pago_servicio import _fin_de_cobertura
from app.dominio.periodicidad import PeriodicidadTarifa
from app.soporte_transversal.tiempo import hoy_club
from tests.arnes_bloqueo_impago import agregar_pago
from tests.test_cobertura_bonificada import (
    _aplicar, _autenticar_como, _escenario_con_beneficio_total,
)


def _activar_beneficio(client, db_session, fin_de_cobertura):
    persona, membresia, _ = _escenario_con_beneficio_total(client, porcentaje=Decimal("100.00"))
    agregar_pago(
        db_session, db_session.get(Persona, persona["id"]), db_session.get(Membresia, membresia["id"]),
        EstadoPago.APROBADO, tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_inicio=fin_de_cobertura - timedelta(days=30), fecha_fin=fin_de_cobertura,
    )
    _autenticar_como(persona["id"], ["ALUMNO"])
    return _aplicar(client, membresia["id"])


@pytest.mark.parametrize("dias_vencido", [1, 2, 3])
def test_activar_el_beneficio_en_la_gracia_ancla_en_el_fin_de_la_cobertura(
    client, db_session, dias_vencido,
):
    fin = hoy_club() - timedelta(days=dias_vencido)

    resp = _activar_beneficio(client, db_session, fin)

    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["fechaInicio"] == fin.isoformat()
    assert cuerpo["fechaFin"] == _fin_de_cobertura(fin, 1, PeriodicidadTarifa.MENSUAL).isoformat()
    fila = db_session.get(CoberturaBonificada, cuerpo["id"])
    assert (fila.fecha_inicio, fila.fecha_fin) == (fin, _fin_de_cobertura(fin, 1, PeriodicidadTarifa.MENSUAL))
    assert db_session.query(Pago).count() == 1


@pytest.mark.parametrize("dias_vencido", [4, 40])
def test_activar_el_beneficio_pasada_la_gracia_ancla_en_hoy(client, db_session, dias_vencido):
    hoy = hoy_club()

    resp = _activar_beneficio(client, db_session, hoy - timedelta(days=dias_vencido))

    assert resp.status_code == 201, resp.text
    assert resp.json()["fechaInicio"] == hoy.isoformat()


def test_activar_el_beneficio_con_cobertura_vigente_sigue_anclando_en_su_fin(client, db_session):
    fin = hoy_club() + timedelta(days=10)

    resp = _activar_beneficio(client, db_session, fin)

    assert resp.status_code == 201, resp.text
    assert resp.json()["fechaInicio"] == fin.isoformat()
