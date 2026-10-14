"""Regla del bloqueo por impago (#1768, S1-S4): se calcula al leer, nunca se guarda.

Se ejercita por la interfaz pública `BloqueoImpagoRepositorio` (la que usan
asistencia, roster y portal) y por los servicios de pago que lo levantan.
"""
from datetime import date, datetime, timedelta, timezone

import pytest

import app.soporte_transversal.tiempo as tiempo
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.periodicidad import PeriodicidadTarifa
from app.infraestructura.repositorios.bloqueo_impago_repositorio import BloqueoImpagoRepositorio
from app.servicios_negocio.dtos.membresia_pago_schemas import (
    PagoCreateDTO, PagoValidarDTO, RegularizacionDeudaDTO,
)
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import crear_persona_orm
from tests.arnes_bloqueo_impago import agregar_pago, crear_miembro, fijar_lanzamiento

HOY = date(2029, 6, 15)


@pytest.fixture(autouse=True)
def _lanzamiento_lejano(monkeypatch):
    fijar_lanzamiento(monkeypatch)


def _bloqueado(db, persona, hoy=HOY) -> bool:
    return BloqueoImpagoRepositorio(db).por_persona(persona.id, hoy=hoy).bloqueado


# --- S1: ventana de gracia ---------------------------------------------------
@pytest.mark.parametrize(
    "dias_desde_el_fin, esperado",
    [(-5, False), (0, False), (1, False), (3, False), (4, True), (30, True)],
)
def test_el_bloqueo_empieza_el_dia_4_tras_el_fin_de_cobertura(db_session, dias_desde_el_fin, esperado):
    persona, _ = crear_miembro(db_session, cubierto_hasta=HOY - timedelta(days=dias_desde_el_fin))

    assert _bloqueado(db_session, persona) is esperado


def test_el_estado_expone_el_fin_de_cobertura_para_el_banner(db_session):
    fin = HOY - timedelta(days=10)
    persona, _ = crear_miembro(db_session, cubierto_hasta=fin)

    estado = BloqueoImpagoRepositorio(db_session).por_persona(persona.id, hoy=HOY)

    assert estado.cubierto_hasta == fin


def test_el_dia_del_club_es_el_de_guayaquil_no_el_utc(db_session, monkeypatch):
    # 02:00 UTC del 16/06 son las 21:00 del 15/06 en Guayaquil. Con el día UTC
    # (16/06) el 12/06 ya estaría en el día 4 y se bloquearía; con el del club
    # (15/06) sigue siendo el día 3.
    instante = datetime(2029, 6, 16, 2, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(tiempo, "ahora_club", lambda: instante.astimezone(tiempo.ZONA_HORARIA_CLUB))
    persona, _ = crear_miembro(db_session, cubierto_hasta=date(2029, 6, 12))

    assert BloqueoImpagoRepositorio(db_session).por_persona(persona.id).bloqueado is False


# --- S4: transición de lanzamiento ---------------------------------------------
def test_sin_fecha_de_lanzamiento_el_bloqueo_esta_apagado(db_session, monkeypatch):
    fijar_lanzamiento(monkeypatch, None)
    persona, _ = crear_miembro(db_session, cubierto_hasta=HOY - timedelta(days=90))

    assert _bloqueado(db_session, persona) is False


@pytest.mark.parametrize(
    "lanzamiento, esperado",
    [
        (HOY - timedelta(days=2), False),   # moroso de antes: la gracia cuenta desde el lanzamiento
        (HOY - timedelta(days=3), False),
        (HOY - timedelta(days=4), True),
        (HOY + timedelta(days=1), False),   # lanzamiento futuro: nadie bloqueado todavía
    ],
)
def test_el_moroso_de_antes_del_lanzamiento_cuenta_la_gracia_desde_el_lanzamiento(
    db_session, monkeypatch, lanzamiento, esperado,
):
    fijar_lanzamiento(monkeypatch, lanzamiento)
    persona, _ = crear_miembro(db_session, cubierto_hasta=HOY - timedelta(days=60))

    assert _bloqueado(db_session, persona) is esperado


def test_si_la_cobertura_termina_despues_del_lanzamiento_manda_la_cobertura(db_session, monkeypatch):
    fijar_lanzamiento(monkeypatch, HOY - timedelta(days=20))
    persona, _ = crear_miembro(db_session, cubierto_hasta=HOY - timedelta(days=3))

    assert _bloqueado(db_session, persona) is False


# --- S1: exenciones --------------------------------------------------------------
@pytest.mark.parametrize("periodicidad", [PeriodicidadTarifa.SEMANAL, PeriodicidadTarifa.DIARIA])
def test_solo_las_tarifas_mensuales_se_bloquean(db_session, periodicidad):
    persona, _ = crear_miembro(
        db_session, cubierto_hasta=HOY - timedelta(days=30), periodicidad=periodicidad,
    )

    assert _bloqueado(db_session, persona) is False


def test_una_membresia_suspendida_no_se_bloquea(db_session):
    persona, _ = crear_miembro(
        db_session, cubierto_hasta=HOY - timedelta(days=30), estado=EstadoMembresia.SUSPENDIDA,
    )

    assert _bloqueado(db_session, persona) is False


def test_el_miembro_gratuito_de_la_familia_no_se_bloquea(db_session):
    persona, _ = crear_miembro(
        db_session, cubierto_hasta=HOY - timedelta(days=30), gratuidad_familiar=True,
    )

    assert _bloqueado(db_session, persona) is False


def test_una_membresia_inactiva_que_nunca_pago_conserva_su_comportamiento(db_session):
    persona, _ = crear_miembro(
        db_session, cubierto_hasta=None, estado=EstadoMembresia.INACTIVA,
    )

    assert _bloqueado(db_session, persona) is False


def test_una_persona_sin_membresia_no_esta_bloqueada(db_session):
    persona = crear_persona_orm(db_session, cedula_valida(7_999_001))

    assert _bloqueado(db_session, persona) is False


def test_una_membresia_activa_vigente_no_se_bloquea(db_session):
    persona, _ = crear_miembro(
        db_session, cubierto_hasta=HOY + timedelta(days=12), estado=EstadoMembresia.ACTIVA,
    )

    assert _bloqueado(db_session, persona) is False


# --- S1/S2: pago pendiente ---------------------------------------------------------
def _moroso_con_pendiente(db, tipo_pago, *, con_voucher, estado=EstadoPago.PENDIENTE_VALIDACION):
    persona, membresia = crear_miembro(db, cubierto_hasta=HOY - timedelta(days=20))
    pago = agregar_pago(
        db, persona, membresia, estado, tipo_pago=tipo_pago, con_voucher=con_voucher,
        fecha_inicio=HOY, fecha_fin=HOY + timedelta(days=30),
    )
    return persona, pago


def test_una_transferencia_pendiente_con_comprobante_levanta_el_bloqueo(db_session):
    persona, _ = _moroso_con_pendiente(db_session, TipoPago.TRANSFERENCIA, con_voucher=True)

    assert _bloqueado(db_session, persona) is False


def test_una_transferencia_pendiente_sin_comprobante_no_levanta_el_bloqueo(db_session):
    persona, _ = _moroso_con_pendiente(db_session, TipoPago.TRANSFERENCIA, con_voucher=False)

    assert _bloqueado(db_session, persona) is True


def test_un_efectivo_pendiente_declarado_por_el_socio_no_levanta_el_bloqueo(db_session):
    persona, _ = _moroso_con_pendiente(db_session, TipoPago.EFECTIVO, con_voucher=False)

    assert _bloqueado(db_session, persona) is True


def test_si_el_admin_rechaza_la_transferencia_el_bloqueo_vuelve(db_session):
    persona, _ = _moroso_con_pendiente(
        db_session, TipoPago.TRANSFERENCIA, con_voucher=True, estado=EstadoPago.RECHAZADO,
    )

    assert _bloqueado(db_session, persona) is True


def test_rechazar_la_transferencia_pendiente_por_el_servicio_re_bloquea(db_session, monkeypatch):
    monkeypatch.setattr("app.servicios_negocio.membresia_pago_servicio.hoy_club", lambda: HOY)
    persona, pago = _moroso_con_pendiente(db_session, TipoPago.TRANSFERENCIA, con_voucher=True)
    assert _bloqueado(db_session, persona) is False

    PagoServicio(db_session).validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.RECHAZADO, motivo_rechazo="Ilegible"),
        actor_persona_id=persona.id,
    )

    assert _bloqueado(db_session, persona) is True


# --- S2: lo que levanta el bloqueo ------------------------------------------------------
def test_aprobar_un_pago_levanta_el_bloqueo(db_session, monkeypatch):
    monkeypatch.setattr("app.servicios_negocio.membresia_pago_servicio.hoy_club", lambda: HOY)
    persona, membresia = crear_miembro(db_session, cubierto_hasta=HOY - timedelta(days=20))
    assert _bloqueado(db_session, persona) is True
    servicio = PagoServicio(db_session)
    pago = servicio.registrar_pago(
        PagoCreateDTO(
            persona_id=persona.id, membresia_id=membresia.id, meses=1,
            tipo_pago=TipoPago.EFECTIVO,
        ),
        persona_id_solicitante=persona.id, roles_solicitante=["ADMINISTRADOR"],
    )

    servicio.validar_pago(
        pago.id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO), actor_persona_id=persona.id,
    )

    assert _bloqueado(db_session, persona) is False


def test_regularizar_la_deuda_levanta_el_bloqueo(db_session, monkeypatch):
    monkeypatch.setattr("app.servicios_negocio.membresia_pago_servicio.hoy_club", lambda: HOY)
    fin = HOY - timedelta(days=20)
    persona, membresia = crear_miembro(db_session, cubierto_hasta=fin)
    assert _bloqueado(db_session, persona) is True

    PagoServicio(db_session).regularizar_deuda(
        membresia.id,
        RegularizacionDeudaDTO(
            monto="25.00", fecha_inicio=fin + timedelta(days=1), fecha_fin=date(2029, 6, 27),
            motivo="Cuaderno de pagos", aplicar_descuento=False,
        ),
        persona_id_admin=persona.id,
    )

    assert _bloqueado(db_session, persona) is False


# --- Una persona con más de una membresía -----------------------------------------------
def test_la_membresia_vigente_de_la_persona_la_libra_de_una_vencida_vieja(db_session):
    persona, _ = crear_miembro(db_session, cubierto_hasta=HOY - timedelta(days=60))
    _, vigente = crear_miembro(
        db_session, cubierto_hasta=HOY + timedelta(days=10), estado=EstadoMembresia.ACTIVA,
    )
    vigente.persona_id = persona.id
    db_session.flush()

    assert _bloqueado(db_session, persona) is False


def test_por_personas_resuelve_a_varias_a_la_vez(db_session):
    moroso, _ = crear_miembro(db_session, cubierto_hasta=HOY - timedelta(days=10))
    al_dia, _ = crear_miembro(db_session, cubierto_hasta=HOY + timedelta(days=10), estado=EstadoMembresia.ACTIVA)

    estados = BloqueoImpagoRepositorio(db_session).por_personas([moroso.id, al_dia.id], hoy=HOY)

    assert estados[moroso.id].bloqueado is True
    assert estados[al_dia.id].bloqueado is False
