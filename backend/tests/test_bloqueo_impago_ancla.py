"""Ancla de la cobertura con ventana de gracia (#1768, S3).

Un pago mensual registrado hasta 3 días después del fin de la cobertura se ancla
en ese fin (no se pierden días ni se cobra un hueco); pasado ese plazo se ancla
en hoy y los meses bloqueados no se cobran. El pago a tiempo no cambia.
"""
from datetime import date, timedelta

import pytest

from app.dominio.enums import EstadoMembresia, TipoPago
from app.dominio.periodicidad import PeriodicidadTarifa
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoCreateDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.arnes_bloqueo_impago import crear_miembro, fijar_lanzamiento

FIN = date(2029, 6, 10)


def _registrar(db, monkeypatch, persona, membresia, hoy, *, meses=1, roles=("ADMINISTRADOR",)):
    monkeypatch.setattr("app.servicios_negocio.membresia_pago_servicio.hoy_club", lambda: hoy)
    return PagoServicio(db).registrar_pago(
        PagoCreateDTO(
            persona_id=persona.id, membresia_id=membresia.id, meses=meses,
            tipo_pago=TipoPago.TRANSFERENCIA,
        ),
        persona_id_solicitante=persona.id, roles_solicitante=list(roles),
    )


@pytest.mark.parametrize("dias_tarde", [1, 2, 3])
def test_pagar_dentro_de_la_gracia_ancla_en_el_fin_de_la_cobertura(db_session, monkeypatch, dias_tarde):
    persona, membresia = crear_miembro(db_session, cubierto_hasta=FIN)

    pago = _registrar(db_session, monkeypatch, persona, membresia, FIN + timedelta(days=dias_tarde))

    assert (pago.fecha_inicio, pago.fecha_fin) == (FIN, date(2029, 7, 10))


@pytest.mark.parametrize(
    "dias_tarde, fin_esperado",
    [(4, date(2029, 8, 14)), (5, date(2029, 8, 15)), (40, date(2029, 9, 20))],
)
def test_pagar_pasada_la_gracia_ancla_en_hoy_y_no_cobra_los_meses_bloqueados(
    db_session, monkeypatch, dias_tarde, fin_esperado,
):
    persona, membresia = crear_miembro(db_session, cubierto_hasta=FIN)
    hoy = FIN + timedelta(days=dias_tarde)

    pago = _registrar(db_session, monkeypatch, persona, membresia, hoy, meses=2)

    assert pago.fecha_inicio == hoy
    assert pago.fecha_fin == fin_esperado
    assert pago.monto_base == membresia.monto_aplicado * 2


@pytest.mark.parametrize("dias_antes", [0, 1, 5])
def test_pagar_a_tiempo_sigue_anclando_en_el_fin_de_la_cobertura(db_session, monkeypatch, dias_antes):
    persona, membresia = crear_miembro(
        db_session, cubierto_hasta=FIN, estado=EstadoMembresia.ACTIVA,
    )

    pago = _registrar(db_session, monkeypatch, persona, membresia, FIN - timedelta(days=dias_antes))

    assert (pago.fecha_inicio, pago.fecha_fin) == (FIN, date(2029, 7, 10))


def test_el_primer_pago_sin_cobertura_previa_ancla_en_hoy(db_session, monkeypatch):
    persona, membresia = crear_miembro(
        db_session, cubierto_hasta=None, estado=EstadoMembresia.INACTIVA,
    )
    hoy = date(2029, 6, 15)

    pago = _registrar(db_session, monkeypatch, persona, membresia, hoy)

    assert (pago.fecha_inicio, pago.fecha_fin) == (hoy, date(2029, 7, 15))


def test_la_gracia_solo_aplica_a_las_tarifas_mensuales(db_session, monkeypatch):
    persona, membresia = crear_miembro(
        db_session, cubierto_hasta=FIN, periodicidad=PeriodicidadTarifa.SEMANAL,
    )
    hoy = FIN + timedelta(days=2)

    pago = _registrar(db_session, monkeypatch, persona, membresia, hoy)

    assert pago.fecha_inicio == hoy


def test_la_gracia_no_depende_de_la_fecha_de_lanzamiento(db_session, monkeypatch):
    fijar_lanzamiento(monkeypatch, None)
    persona, membresia = crear_miembro(db_session, cubierto_hasta=FIN)

    pago = _registrar(db_session, monkeypatch, persona, membresia, FIN + timedelta(days=2))

    assert pago.fecha_inicio == FIN
