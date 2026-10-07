"""
Tarifas semanales y diarias (owner polish 2026-10-06, S4).

Decisiones del dueño, vinculantes:
- DIARIA = "Paga por día suelto": un pago cubre SOLO el día pagado.
- SEMANAL: un pago cubre una semana (7 días) desde la fecha pagada.
- "No acumula deuda": las membresías de tarifa DIARIA/SEMANAL jamás generan
  meses adeudados ni avisos de mora; los meses adeudados solo aplican a MENSUAL.

Cantidad de períodos por pago: DIARIA/SEMANAL cobran exactamente UN período por
pago (`meses` debe ser 1); MENSUAL conserva el selector de meses de siempre.
"""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

import app.infraestructura.tareas.alertas_tareas as alertas_mod
import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoNotificacion, TipoPago
from app.dominio.modelos import Membresia, Notificacion, Pago, TipoMembresia
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from tests.conftest import FECHA_CONGELADA_HOY
from tests.fabricas_pagos import (
    crear_membresia_api,
    crear_persona_api,
    crear_persona_orm,
    nombre_tarifa_unico,
    registrar_pago_api,
)

RUTA_TIPOS = "/api/v1/membresias/tipos"


def _crear_tarifa(client, periodicidad: str | None, precio: str = "5.00") -> dict:
    cuerpo = {
        "categoria": nombre_tarifa_unico("Tarifa"), "precio": precio,
        "modalidad": "MENSUAL",
    }
    if periodicidad is not None:
        cuerpo["periodicidad"] = periodicidad
    resp = client.post(RUTA_TIPOS, json=cuerpo)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _congelar_hoy(monkeypatch, fecha: date = FECHA_CONGELADA_HOY) -> None:
    monkeypatch.setattr(mps, "hoy_club", lambda: fecha)


def _escenario(client, periodicidad: str | None, precio: str = "5.00"):
    persona = crear_persona_api(client)
    tipo = _crear_tarifa(client, periodicidad, precio)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    return persona, tipo, membresia


# --- Admin: crear / editar ---------------------------------------------------

def test_tarifa_sin_periodicidad_es_mensual_por_defecto(client):
    tipo = _crear_tarifa(client, None)
    assert tipo["periodicidad"] == "MENSUAL"


@pytest.mark.parametrize("periodicidad", ["SEMANAL", "DIARIA"])
def test_admin_crea_tarifas_semanales_y_diarias(client, periodicidad):
    tipo = _crear_tarifa(client, periodicidad)
    assert tipo["periodicidad"] == periodicidad
    listado = client.get(RUTA_TIPOS).json()
    assert [t["periodicidad"] for t in listado if t["id"] == tipo["id"]] == [periodicidad]


def test_periodicidad_invalida_es_rechazada(client):
    resp = client.post(RUTA_TIPOS, json={
        "categoria": nombre_tarifa_unico("Tarifa"), "precio": "5.00",
        "modalidad": "MENSUAL", "periodicidad": "ANUAL",
    })
    assert resp.status_code == 422


def test_admin_edita_la_periodicidad_de_una_tarifa(client):
    tipo = _crear_tarifa(client, "MENSUAL")
    resp = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"periodicidad": "SEMANAL"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["periodicidad"] == "SEMANAL"


def test_patch_con_periodicidad_nula_es_rechazado(client):
    tipo = _crear_tarifa(client, "MENSUAL")
    resp = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"periodicidad": None})
    assert resp.status_code == 422


def test_la_membresia_expone_la_periodicidad_de_su_tarifa(client):
    _persona, _tipo, membresia = _escenario(client, "DIARIA")
    assert membresia["periodicidad"] == "DIARIA"
    leida = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert leida["periodicidad"] == "DIARIA"


# --- Cobertura ---------------------------------------------------------------

def test_pago_semanal_cubre_siete_dias_desde_la_fecha_pagada(client, monkeypatch):
    _congelar_hoy(monkeypatch)
    persona, _tipo, membresia = _escenario(client, "SEMANAL", "10.00")

    resp = registrar_pago_api(client, persona["id"], membresia["id"])

    assert resp.status_code == 201, resp.text
    pago = resp.json()
    assert pago["fechaInicio"] == FECHA_CONGELADA_HOY.isoformat()
    assert pago["fechaFin"] == (FECHA_CONGELADA_HOY + timedelta(days=7)).isoformat()
    assert Decimal(pago["monto"]) == Decimal("10.00")


def test_pago_diario_cubre_solo_el_dia_pagado(client, monkeypatch):
    _congelar_hoy(monkeypatch)
    persona, _tipo, membresia = _escenario(client, "DIARIA", "3.00")

    resp = registrar_pago_api(client, persona["id"], membresia["id"])

    assert resp.status_code == 201, resp.text
    pago = resp.json()
    assert pago["fechaInicio"] == FECHA_CONGELADA_HOY.isoformat()
    assert pago["fechaFin"] == (FECHA_CONGELADA_HOY + timedelta(days=1)).isoformat()
    assert Decimal(pago["monto"]) == Decimal("3.00")


@pytest.mark.parametrize("periodicidad", ["SEMANAL", "DIARIA"])
def test_semanal_y_diaria_cobran_un_solo_periodo_por_pago(client, monkeypatch, periodicidad):
    _congelar_hoy(monkeypatch)
    persona, _tipo, membresia = _escenario(client, periodicidad)

    resp = registrar_pago_api(client, persona["id"], membresia["id"], meses=2)

    assert resp.status_code == 400, resp.text


def test_pago_mensual_sigue_cubriendo_meses_calendario(client, monkeypatch):
    _congelar_hoy(monkeypatch, date(2026, 1, 31))
    persona, _tipo, membresia = _escenario(client, None, "35.00")

    resp = registrar_pago_api(client, persona["id"], membresia["id"], meses=2)

    assert resp.status_code == 201, resp.text
    pago = resp.json()
    assert pago["fechaInicio"] == "2026-01-31"
    assert pago["fechaFin"] == "2026-03-31"
    assert Decimal(pago["monto"]) == Decimal("70.00")


def test_pago_semanal_se_ancla_a_la_cobertura_vigente(client, db_session, monkeypatch):
    _congelar_hoy(monkeypatch)
    persona, _tipo, membresia = _escenario(client, "SEMANAL", "10.00")
    primero = registrar_pago_api(client, persona["id"], membresia["id"]).json()
    client.patch(
        f"/api/v1/membresias/pagos/{primero['id']}/validar",
        json={"estado_pago": "APROBADO",
              "motivo_excepcion_sin_comprobante": "Verificado en la cuenta del club."},
    )

    segundo = registrar_pago_api(client, persona["id"], membresia["id"]).json()

    assert segundo["fechaInicio"] == primero["fechaFin"]
    assert segundo["fechaFin"] == (FECHA_CONGELADA_HOY + timedelta(days=14)).isoformat()


# --- Deuda -------------------------------------------------------------------

def _membresia_orm_con_pago_vencido(db, periodicidad: str, cedula: str):
    persona = crear_persona_orm(db, cedula)
    tipo = TipoMembresia(
        categoria=nombre_tarifa_unico("Deuda"), precio=Decimal("30.00"),
        modalidad="MENSUAL", periodicidad=periodicidad,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.flush()
    db.add(Pago(
        monto=Decimal("30.00"), estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO, fecha_inicio=date(2026, 2, 1),
        fecha_fin=date(2026, 3, 1), persona_id=persona.id, membresia_id=membresia.id,
    ))
    db.flush()
    return membresia


@pytest.mark.parametrize("periodicidad,esperados", [
    ("MENSUAL", 5), ("SEMANAL", 0), ("DIARIA", 0),
])
def test_deuda_solo_se_acumula_en_tarifas_mensuales(
    client, db_session, monkeypatch, periodicidad, esperados,
):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    membresia = _membresia_orm_con_pago_vencido(db_session, periodicidad, "1710034065")

    individual = client.get(f"/api/v1/membresias/{membresia.id}/deuda").json()
    bulk = client.get(
        f"/api/v1/membresias/deuda/bulk?membresia_ids={membresia.id}"
    ).json()[0]

    assert individual["mesesAdeudados"] == esperados
    assert bulk["mesesAdeudados"] == esperados


def test_regularizar_deuda_se_rechaza_en_tarifas_sin_deuda(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    membresia = _membresia_orm_con_pago_vencido(db_session, "SEMANAL", "1710034065")

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={"monto": "30.00", "fecha_inicio": "2026-03-01", "fecha_fin": "2026-04-01",
              "motivo": "Regularización de prueba"},
    )

    assert resp.status_code == 400, resp.text


# --- Mora --------------------------------------------------------------------

HOY_MORA = date(2029, 6, 15)


@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(alertas_mod, "SessionLocal", _factory)
    return db_session


def _mora_con_tarifa(db, periodicidad: str, cedula: str):
    persona = crear_persona_orm(db, cedula)
    tipo = TipoMembresia(
        categoria=nombre_tarifa_unico("Mora"), precio=Decimal("30.00"),
        modalidad="MENSUAL", periodicidad=periodicidad,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.flush()
    db.add(Pago(
        monto=Decimal("30.00"), estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO, fecha_registro=datetime(2029, 6, 1, tzinfo=timezone.utc),
        fecha_inicio=HOY_MORA - timedelta(days=8), fecha_fin=HOY_MORA - timedelta(days=1),
        persona_id=persona.id, membresia_id=membresia.id,
    ))
    db.commit()
    return persona


@pytest.mark.parametrize("periodicidad,avisos", [
    ("MENSUAL", 1), ("SEMANAL", 0), ("DIARIA", 0),
])
def test_mora_solo_avisa_a_tarifas_mensuales(
    db_session, sesion_inyectada, monkeypatch, periodicidad, avisos,
):
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: HOY_MORA)
    monkeypatch.setattr(ServicioNotificaciones, "enviar_correo", lambda self, **kw: None)
    persona = _mora_con_tarifa(db_session, periodicidad, cedula_valida(310))

    resultado = alertas_mod.alertar_mora_diaria()

    assert resultado["total_avisos_familia"] == avisos
    assert db_session.query(Notificacion).filter(
        Notificacion.tipo == TipoNotificacion.MIEMBRESIA_MORA_DIA_1,
        Notificacion.persona_id == persona.id,
    ).count() == avisos


def test_catalogo_publico_expone_la_periodicidad(db_session, client_sin_token):
    db_session.add(TipoMembresia(
        categoria=nombre_tarifa_unico("Publica"), precio=Decimal("3.00"),
        modalidad="MENSUAL", periodicidad="DIARIA",
    ))
    db_session.flush()

    items = client_sin_token.get("/api/v1/membresias/tarifas").json()

    assert [i["periodicidad"] for i in items if i["categoria"].startswith("Publica")] == ["DIARIA"]
