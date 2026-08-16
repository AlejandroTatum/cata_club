"""
Regularización de deuda de membresías (issue #284).

La deuda es un valor DERIVADO: meses adeudados desde la última cobertura
aprobada (`fecha_fin_maxima_aprobada`) hasta hoy, sin columna nueva. Solo la ve
un administrador y se regulariza con fechas retroactivas explícitas + motivo
obligatorio. El flujo normal de `registrar_pago` NO cambia (sigue anclando en
`max(última_fecha_fin, hoy)`).

Ver `app.servicios_negocio.membresia_pago_servicio.PagoServicio.regularizar_deuda`
para las decisiones conservadoras (APROBADO directo, sin tocar membresía, sin
notificaciones/PDF/regla familiar).
"""
from datetime import date
from decimal import Decimal

import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.modelos import Pago
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import crear_persona_orm, crear_tipo_membresia_orm, crear_membresia_orm


def _crear_persona_membresia(sesion, monto_aplicado: str = "30.00"):
    persona = crear_persona_orm(sesion, "1710034065")
    tipo = crear_tipo_membresia_orm(sesion, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        sesion, persona, tipo, EstadoMembresia.ACTIVA,
        monto_aplicado=Decimal(monto_aplicado),
    )
    return persona, membresia


def _crear_pago_aprobado(sesion, persona, membresia, fecha_fin: date, monto: str = "30.00") -> Pago:
    """Pago APROBADO con `fecha_fin` arbitraria (el factory `crear_pago_orm`
    hardcodea julio; acá necesitamos marzo/abril para la deuda)."""
    pago = Pago(
        monto=Decimal(monto),
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(fecha_fin.year, fecha_fin.month, 1),
        fecha_fin=fecha_fin,
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    sesion.add(pago)
    sesion.flush()
    return pago


# --- Cálculo de meses adeudados ---------------------------------------------

def test_calcular_meses_adeudados_sin_pagos_aprobados(db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    _, membresia = _crear_persona_membresia(db_session)
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 0


def test_calcular_meses_adeudados_cobertura_hasta_hoy(db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 8, 15))
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 0


def test_calcular_meses_adeudados_cobertura_hasta_marzo(db_session, monkeypatch):
    """Ejemplo del issue: cobertura hasta 2026-03-31, hoy 2026-08-15 → 4 meses
    (abril, mayo, junio, julio)."""
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 4


def test_calcular_meses_adeudados_borde_dia_15_exacto(db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 4, 15))
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 4


def test_calcular_meses_adeudados_borde_dia_16(db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 4, 16))
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 3


# --- GET deuda (solo admin) ---------------------------------------------------

def test_get_deuda_admin_la_ve(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.get(f"/api/v1/membresias/{membresia.id}/deuda")
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["mesesAdeudados"] == 4
    assert cuerpo["ultimaCoberturaFin"] == "2026-03-31"
    assert Decimal(str(cuerpo["montoMensual"])) == Decimal("30.00")


def test_get_deuda_sin_rol_admin_da_403(client_sin_permisos, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    _, membresia = _crear_persona_membresia(db_session)
    resp = client_sin_permisos.get(f"/api/v1/membresias/{membresia.id}/deuda")
    assert resp.status_code == 403


# --- Regularización -----------------------------------------------------------

def test_regularizacion_total(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "120.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-07-31",
            "motivo": "Regularización por demora del club",
        },
    )
    assert resp.status_code == 201, resp.text
    pago = resp.json()
    assert pago["estadoPago"] == "APROBADO"
    assert pago["tipoPago"] == "REGULARIZACION"
    assert pago["fechaInicio"] == "2026-04-01"
    assert pago["fechaFin"] == "2026-07-31"
    assert pago["fechaValidacion"] is not None

    fila = db_session.get(Pago, pago["id"])
    assert fila.regularizada_por_persona_id == 1
    assert fila.motivo_regularizacion == "Regularización por demora del club"


def test_regularizacion_parcial_deja_deuda_restante(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-04-30",
            "motivo": "Regularización parcial de abril",
        },
    )
    assert resp.status_code == 201, resp.text

    deuda = client.get(f"/api/v1/membresias/{membresia.id}/deuda")
    assert deuda.status_code == 200
    assert deuda.json()["mesesAdeudados"] == 3


def test_regularizacion_solapada_da_400(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-03-15",
            "fecha_fin": "2026-04-15",
            "motivo": "Pisa cobertura ya aprobada",
        },
    )
    assert resp.status_code == 400
    assert "cubierto por un pago aprobado" in resp.json()["detail"]


def test_regularizacion_monto_no_multiplo_da_400(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "50.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-04-30",
            "motivo": "Monto no múltiplo",
        },
    )
    assert resp.status_code == 400


def test_regularizacion_motivo_solo_espacios_da_422(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    _, membresia = _crear_persona_membresia(db_session)

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-04-30",
            "motivo": "   ",
        },
    )
    assert resp.status_code == 422


def test_regularizacion_fecha_inicio_futura_da_400(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-09-01",
            "fecha_fin": "2026-09-30",
            "motivo": "Fecha futura",
        },
    )
    assert resp.status_code == 400


def test_regularizacion_sin_rol_admin_da_403(client_sin_permisos, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    _, membresia = _crear_persona_membresia(db_session)

    resp = client_sin_permisos.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-04-30",
            "motivo": "Sin permisos",
        },
    )
    assert resp.status_code == 403


# --- El flujo normal NO cambia -------------------------------------------------

def test_registrar_pago_sigue_anclando_en_hoy(client, db_session, monkeypatch):
    """PAG-5 convive sin agujero: con cobertura aprobada hasta marzo y hoy en
    agosto, un pago normal de 1 mes arranca en agosto (max(última_fecha_fin, hoy)),
    no en marzo ni perdona el hueco."""
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        "/api/v1/membresias/pagos",
        json={
            "monto": "30.00",
            "tipo_pago": "TRANSFERENCIA",
            "persona_id": persona.id,
            "membresia_id": membresia.id,
        },
    )
    assert resp.status_code == 201, resp.text
    pago = resp.json()
    assert pago["fechaInicio"] == "2026-08-15"
    assert pago["fechaFin"] == "2026-09-15"
