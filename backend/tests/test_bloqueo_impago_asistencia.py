"""Bloqueo por impago en la toma de asistencia y en el roster (#1768, S2, S5)."""
from datetime import timedelta

import pytest

from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.modelos import Asistencia
from app.soporte_transversal.tiempo import hoy_club
from tests.arnes_bloqueo_impago import agregar_pago, crear_miembro, fijar_lanzamiento
from tests.fechas_validas import ultima_fecha_en
from tests.test_asistencias import _crear_persona_api

URL_UNA = "/api/v1/asistencias"
URL_LOTE = "/api/v1/asistencias/lote"


@pytest.fixture(autouse=True)
def _lanzamiento_lejano(monkeypatch):
    fijar_lanzamiento(monkeypatch)


def _horario(client, db_session, *miembros):
    """Autor (id=1, el `persona_id` del token) + un horario con `miembros` asignados."""
    _crear_persona_api(client, "1710034065", "Autor")
    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    for persona in miembros:
        resp = client.post(
            "/api/v1/asistencias/asignar-alumno",
            json={"persona_id": persona.id, "horario_id": horario["id"]},
        )
        assert resp.status_code in (200, 201), resp.text
    return horario, str(ultima_fecha_en("LUNES"))


def _cuerpo(horario, fecha, persona):
    return {
        "horario_id": horario["id"], "persona_id": persona.id,
        "fecha_entrenamiento": fecha, "estado": "PRESENTE",
    }


def _moroso(db, dias_vencido=10, **kwargs):
    return crear_miembro(db, cubierto_hasta=hoy_club() - timedelta(days=dias_vencido), **kwargs)[0]


# --- S5: registro individual -----------------------------------------------------------
def test_la_asistencia_de_un_jugador_bloqueado_se_rechaza_con_pago_pendiente(client, db_session):
    moroso = _moroso(db_session)
    horario, fecha = _horario(client, db_session, moroso)

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, moroso))

    assert resp.status_code == 400
    assert "pago pendiente" in resp.json()["detail"]
    assert db_session.query(Asistencia).count() == 0


def test_el_dia_3_de_gracia_todavia_se_registra_la_asistencia(client, db_session):
    en_gracia = _moroso(db_session, dias_vencido=3)
    horario, fecha = _horario(client, db_session, en_gracia)

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, en_gracia))

    assert resp.status_code == 201, resp.text


def test_una_transferencia_pendiente_con_comprobante_permite_registrar_asistencia(client, db_session):
    persona, membresia = crear_miembro(db_session, cubierto_hasta=hoy_club() - timedelta(days=10))
    agregar_pago(
        db_session, persona, membresia, EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.TRANSFERENCIA, con_voucher=True,
        fecha_inicio=hoy_club(), fecha_fin=hoy_club() + timedelta(days=30),
    )
    horario, fecha = _horario(client, db_session, persona)

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, persona))

    assert resp.status_code == 201, resp.text


def test_un_efectivo_pendiente_no_permite_registrar_asistencia(client, db_session):
    persona, membresia = crear_miembro(db_session, cubierto_hasta=hoy_club() - timedelta(days=10))
    agregar_pago(
        db_session, persona, membresia, EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=hoy_club(), fecha_fin=hoy_club() + timedelta(days=30),
    )
    horario, fecha = _horario(client, db_session, persona)

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, persona))

    assert resp.status_code == 400


def test_sin_fecha_de_lanzamiento_la_cuota_vencida_sigue_sin_impedir_entrenar(
    client, db_session, monkeypatch,
):
    """Regresión de la decisión de negocio #4 mientras el bloqueo está apagado."""
    fijar_lanzamiento(monkeypatch, None)
    vencido = _moroso(db_session, dias_vencido=90)
    horario, fecha = _horario(client, db_session, vencido)

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, vencido))

    assert resp.status_code == 201, resp.text


def test_un_jugador_gratuito_con_cobertura_vieja_no_se_bloquea(client, db_session):
    gratuito = _moroso(db_session, dias_vencido=90, gratuidad_familiar=True)
    horario, fecha = _horario(client, db_session, gratuito)

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, gratuito))

    assert resp.status_code == 201, resp.text


# --- S5: toma de lista en lote -----------------------------------------------------------
def test_el_lote_deja_al_bloqueado_en_fallidos_y_registra_al_resto(client, db_session):
    moroso = _moroso(db_session)
    al_dia, _ = crear_miembro(
        db_session, cubierto_hasta=hoy_club() + timedelta(days=10), estado=EstadoMembresia.ACTIVA,
    )
    horario, fecha = _horario(client, db_session, moroso, al_dia)

    resp = client.post(URL_LOTE, json={
        "horario_id": horario["id"], "fecha": fecha,
        "items": [{"persona_id": p.id, "estado": "PRESENTE"} for p in (moroso, al_dia)],
    })

    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["creados"] == 1
    assert [f["personaId"] for f in cuerpo["fallidos"]] == [moroso.id]
    assert "pago pendiente" in cuerpo["fallidos"][0]["motivo"]
    assert cuerpo["fallidos"][0]["yaRegistrada"] is False
    assert [a.persona_id for a in db_session.query(Asistencia).all()] == [al_dia.id]


def test_el_lote_sin_bloqueados_registra_a_todos_como_siempre(client, db_session):
    a = _moroso(db_session, dias_vencido=2)
    b, _ = crear_miembro(
        db_session, cubierto_hasta=hoy_club() + timedelta(days=10), estado=EstadoMembresia.ACTIVA,
    )
    horario, fecha = _horario(client, db_session, a, b)

    resp = client.post(URL_LOTE, json={
        "horario_id": horario["id"], "fecha": fecha,
        "items": [{"persona_id": p.id, "estado": "PRESENTE"} for p in (a, b)],
    })

    assert resp.json()["creados"] == 2
    assert resp.json()["fallidos"] == []


# --- S5: roster -------------------------------------------------------------------------------
def test_el_roster_marca_al_bloqueado_y_lo_sigue_listando(client, db_session):
    moroso = _moroso(db_session)
    al_dia, _ = crear_miembro(
        db_session, cubierto_hasta=hoy_club() + timedelta(days=10), estado=EstadoMembresia.ACTIVA,
    )
    horario, _ = _horario(client, db_session, moroso, al_dia)

    resp = client.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")

    assert resp.status_code == 200, resp.text
    filas = {fila["personaId"]: fila for fila in resp.json()["items"]}
    assert set(filas) == {moroso.id, al_dia.id}
    assert filas[moroso.id]["bloqueadoPorImpago"] is True
    assert filas[al_dia.id]["bloqueadoPorImpago"] is False


def test_el_roster_de_todos_los_horarios_tambien_marca_al_bloqueado(client, db_session):
    moroso = _moroso(db_session)
    _horario(client, db_session, moroso)

    resp = client.get("/api/v1/asistencias/horarios/alumnos")

    assert [f["bloqueadoPorImpago"] for f in resp.json()] == [True]


def test_el_roster_conserva_su_forma_y_nadie_figura_bloqueado_con_el_bloqueo_apagado(
    client, db_session, monkeypatch,
):
    fijar_lanzamiento(monkeypatch, None)
    vencido = _moroso(db_session, dias_vencido=90)
    horario, _ = _horario(client, db_session, vencido)

    resp = client.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos")

    fila = resp.json()["items"][0]
    assert fila["personaId"] == vencido.id
    assert fila["bloqueadoPorImpago"] is False
    assert {"personaNombreCompleto", "edad", "horarioId", "horarioDia"} <= set(fila)


def test_los_horarios_de_un_alumno_marcan_si_esta_bloqueado(client, db_session):
    moroso = _moroso(db_session)
    _horario(client, db_session, moroso)

    resp = client.get(f"/api/v1/asistencias/alumnos/{moroso.id}/horarios")

    assert [f["bloqueadoPorImpago"] for f in resp.json()] == [True]
