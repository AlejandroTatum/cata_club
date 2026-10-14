"""Bloqueo por impago en la toma de asistencia y en el roster (#1768, S2, S5)."""
from datetime import date, timedelta

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


def _horario(client, db_session, *miembros, semanas_atras=0):
    """Autor (id=1, el `persona_id` del token) + un horario con `miembros` asignados.
    La fecha devuelta es el último lunes, o el de `semanas_atras` semanas antes."""
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
    return horario, str(ultima_fecha_en("LUNES", semanas_atras))


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


# --- S1 (#1779): el bloqueo se juzga el día de la sesión, no hoy ---------------------------
def _miembro_vencido_el(db, fecha_sesion, dias_antes_de_la_sesion):
    return crear_miembro(
        db, cubierto_hasta=date.fromisoformat(fecha_sesion) - timedelta(days=dias_antes_de_la_sesion),
    )[0]


def test_una_sesion_pasada_se_registra_si_el_jugador_aun_estaba_en_gracia_ese_dia(client, db_session):
    horario, fecha = _horario(client, db_session, semanas_atras=1)
    # Su cobertura termina 2 días antes de la sesión: hoy lleva días vencido,
    # pero ese día todavía estaba en gracia.
    persona = _miembro_vencido_el(db_session, fecha, 2)
    client.post(
        "/api/v1/asistencias/asignar-alumno", json={"persona_id": persona.id, "horario_id": horario["id"]},
    )

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, persona))

    assert resp.status_code == 201, resp.text
    assert [a.persona_id for a in db_session.query(Asistencia).all()] == [persona.id]


def test_una_sesion_pasada_se_rechaza_si_el_jugador_ya_estaba_bloqueado_ese_dia(client, db_session):
    horario, fecha = _horario(client, db_session, semanas_atras=1)
    persona = _miembro_vencido_el(db_session, fecha, 4)
    client.post(
        "/api/v1/asistencias/asignar-alumno", json={"persona_id": persona.id, "horario_id": horario["id"]},
    )

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, persona))

    assert resp.status_code == 400
    assert "pago pendiente" in resp.json()["detail"]
    assert db_session.query(Asistencia).count() == 0


def test_el_lote_de_una_sesion_pasada_juzga_a_cada_jugador_por_el_dia_de_la_sesion(client, db_session):
    horario, fecha = _horario(client, db_session, semanas_atras=1)
    en_gracia = _miembro_vencido_el(db_session, fecha, 3)
    bloqueado = _miembro_vencido_el(db_session, fecha, 4)
    for persona in (en_gracia, bloqueado):
        client.post(
            "/api/v1/asistencias/asignar-alumno",
            json={"persona_id": persona.id, "horario_id": horario["id"]},
        )

    resp = client.post(URL_LOTE, json={
        "horario_id": horario["id"], "fecha": fecha,
        "items": [{"persona_id": p.id, "estado": "PRESENTE"} for p in (en_gracia, bloqueado)],
    })

    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["creados"] == 1
    assert [f["personaId"] for f in cuerpo["fallidos"]] == [bloqueado.id]
    assert [a.persona_id for a in db_session.query(Asistencia).all()] == [en_gracia.id]


# --- S15 (#1779): el roster juzga el bloqueo en la fecha de la sesión ---------------------
def _roster(client, horario, fecha=None):
    url = f"/api/v1/asistencias/horarios/{horario['id']}/alumnos"
    resp = client.get(url, params={"fecha": fecha} if fecha else None)
    assert resp.status_code == 200, resp.text
    return {fila["personaId"]: fila["bloqueadoPorImpago"] for fila in resp.json()["items"]}


def _roster_con_pasado(client, db_session):
    """Sesión de hace una semana: `en_gracia` ese día estaba a 2 días de vencer
    (hoy ya bloqueado), `bloqueado` ya llevaba 4 días vencido ese día."""
    horario, fecha = _horario(client, db_session, semanas_atras=1)
    en_gracia = _miembro_vencido_el(db_session, fecha, 2)
    bloqueado = _miembro_vencido_el(db_session, fecha, 4)
    for persona in (en_gracia, bloqueado):
        client.post(
            "/api/v1/asistencias/asignar-alumno",
            json={"persona_id": persona.id, "horario_id": horario["id"]},
        )
    return horario, fecha, en_gracia, bloqueado


def test_el_roster_con_fecha_de_sesion_pasada_desbloquea_a_quien_aun_estaba_en_gracia(
    client, db_session,
):
    horario, fecha, en_gracia, bloqueado = _roster_con_pasado(client, db_session)

    assert _roster(client, horario) == {en_gracia.id: True, bloqueado.id: True}
    assert _roster(client, horario, fecha) == {en_gracia.id: False, bloqueado.id: True}


def test_el_roster_de_todos_los_horarios_tambien_acepta_la_fecha_de_sesion(client, db_session):
    horario, fecha, en_gracia, bloqueado = _roster_con_pasado(client, db_session)

    resp = client.get("/api/v1/asistencias/horarios/alumnos", params={"fecha": fecha})

    assert resp.status_code == 200, resp.text
    assert {f["personaId"]: f["bloqueadoPorImpago"] for f in resp.json()} == {
        en_gracia.id: False, bloqueado.id: True,
    }


def test_el_roster_con_fecha_de_hoy_es_igual_al_roster_sin_fecha(client, db_session):
    horario, _, en_gracia, bloqueado = _roster_con_pasado(client, db_session)

    assert _roster(client, horario, hoy_club().isoformat()) == _roster(client, horario)


def test_el_roster_con_fecha_futura_se_rechaza_como_el_registro_de_asistencia(client, db_session):
    horario, _, _, _ = _roster_con_pasado(client, db_session)
    manana = (hoy_club() + timedelta(days=1)).isoformat()

    resp = client.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos", params={"fecha": manana})

    assert resp.status_code == 400
    assert "fecha futura" in resp.json()["detail"]


def test_el_roster_con_fecha_mal_formada_se_rechaza_con_422(client, db_session):
    horario, _, _, _ = _roster_con_pasado(client, db_session)

    resp = client.get(f"/api/v1/asistencias/horarios/{horario['id']}/alumnos", params={"fecha": "ayer"})

    assert resp.status_code == 422


def test_el_roster_con_fecha_resuelve_el_bloqueo_con_una_sola_lectura_para_todos(
    client, db_session, contar_selects,
):
    horario, fecha = _horario(client, db_session, semanas_atras=1)

    def asignar_y_medir(cantidad):
        for _ in range(cantidad):
            persona = _miembro_vencido_el(db_session, fecha, 2)
            client.post(
                "/api/v1/asistencias/asignar-alumno",
                json={"persona_id": persona.id, "horario_id": horario["id"]},
            )
        with contar_selects() as sentencias:
            assert len(_roster(client, horario, fecha)) >= cantidad
        lecturas = [s for s in sentencias if s.startswith("SELECT membresia.")]
        return len(sentencias), len(lecturas)

    totales_con_2, lecturas_con_2 = asignar_y_medir(2)
    totales_con_5, lecturas_con_5 = asignar_y_medir(3)  # 5 en total

    assert lecturas_con_2 == lecturas_con_5 == 1
    assert totales_con_2 == totales_con_5  # el costo no crece con el roster (sin N+1)


# --- S2 (#1779): código de motivo estable --------------------------------------------------
CODIGO_BLOQUEO = "asistencia_bloqueada_por_impago"


def test_el_registro_individual_bloqueado_lleva_el_codigo_de_motivo_y_conserva_el_mensaje(
    client, db_session,
):
    moroso = _moroso(db_session)
    horario, fecha = _horario(client, db_session, moroso)

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, moroso))

    assert resp.status_code == 400
    cuerpo = resp.json()
    assert cuerpo["codigo"] == CODIGO_BLOQUEO
    assert "tiene un pago pendiente y no puede registrar asistencia" in cuerpo["detail"]
    assert db_session.query(Asistencia).count() == 0


def test_otros_rechazos_individuales_no_llevan_el_codigo_del_bloqueo(client, db_session):
    persona = _moroso(db_session, dias_vencido=1)
    horario, fecha = _horario(client, db_session, persona)
    assert client.post(URL_UNA, json=_cuerpo(horario, fecha, persona)).status_code == 201

    resp = client.post(URL_UNA, json=_cuerpo(horario, fecha, persona))

    assert resp.status_code == 400
    assert "codigo" not in resp.json()


def test_el_lote_marca_con_el_codigo_solo_al_fallido_por_bloqueo(client, db_session):
    moroso = _moroso(db_session)
    al_dia, _ = crear_miembro(
        db_session, cubierto_hasta=hoy_club() + timedelta(days=10), estado=EstadoMembresia.ACTIVA,
    )
    ajeno, _ = crear_miembro(
        db_session, cubierto_hasta=hoy_club() + timedelta(days=10), estado=EstadoMembresia.ACTIVA,
    )
    horario, fecha = _horario(client, db_session, moroso, al_dia)

    resp = client.post(URL_LOTE, json={
        "horario_id": horario["id"], "fecha": fecha,
        "items": [{"persona_id": p.id, "estado": "PRESENTE"} for p in (moroso, al_dia, ajeno)],
    })

    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["creados"] == 1
    codigos = {f["personaId"]: f["codigo"] for f in cuerpo["fallidos"]}
    assert codigos == {moroso.id: CODIGO_BLOQUEO, ajeno.id: None}
    assert "pago pendiente" in next(
        f["motivo"] for f in cuerpo["fallidos"] if f["personaId"] == moroso.id
    )
    assert [a.persona_id for a in db_session.query(Asistencia).all()] == [al_dia.id]
