"""POST /asistencias/lote: toma de lista en una sola llamada (ENT-01, ENT-10, ENT-04)."""
from datetime import date

import app.servicios_negocio.asistencia_servicio as servicio_asistencia
from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Asistencia, SesionAsistencia
from tests.fechas_validas import ultima_fecha_en
from tests.nombres_validos import nombre_unico
from tests.test_asistencias import _crear_persona_api

URL = "/api/v1/asistencias/lote"


def _escenario(client, cantidad):
    """Autor (id=1, el `persona_id` del token) + `cantidad` alumnos asignados."""
    _crear_persona_api(client, cedula_valida(9500), "Autor")
    horario = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "LUNES"},
    ).json()
    alumnos = []
    for i in range(cantidad):
        alumno = _crear_persona_api(client, cedula_valida(9510 + i), nombre_unico(i, "Alumno"))
        client.post(
            "/api/v1/asistencias/asignar-alumno",
            json={"persona_id": alumno["id"], "horario_id": horario["id"]},
        )
        alumnos.append(alumno)
    return horario, alumnos, str(ultima_fecha_en("LUNES"))


def _cuerpo(horario, fecha, alumnos, estado="PRESENTE"):
    return {
        "horario_id": horario["id"], "fecha": fecha,
        "items": [{"persona_id": a["id"], "estado": estado} for a in alumnos],
    }


def test_lote_registra_a_todos_y_cierra_la_sesion_una_sola_vez(client, db_session):
    horario, alumnos, fecha = _escenario(client, 5)

    resp = client.post(URL, json=_cuerpo(horario, fecha, alumnos))

    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["creados"] == 5
    assert cuerpo["fallidos"] == []
    assert cuerpo["registradoPorNombre"] == "Autor Torres"
    assert db_session.query(Asistencia).count() == 5
    assert db_session.query(SesionAsistencia).count() == 1


def test_lote_es_parcial_por_alumno_con_reporte_de_fallidos(client, db_session):
    horario, alumnos, fecha = _escenario(client, 3)
    ajeno = _crear_persona_api(client, cedula_valida(9600), "Zoe")  # sin asignar

    resp = client.post(URL, json=_cuerpo(horario, fecha, alumnos + [ajeno]))

    assert resp.status_code == 201, resp.text
    cuerpo = resp.json()
    assert cuerpo["creados"] == 3
    assert [f["personaId"] for f in cuerpo["fallidos"]] == [ajeno["id"]]
    assert "lista de alumnos" in cuerpo["fallidos"][0]["motivo"]
    assert cuerpo["fallidos"][0]["yaRegistrada"] is False
    assert db_session.query(Asistencia).count() == 3


def test_lote_con_persona_repetida_se_rechaza_con_400_sin_guardar_nada(client, db_session):
    horario, alumnos, fecha = _escenario(client, 2)
    cuerpo = _cuerpo(horario, fecha, alumnos + [alumnos[0]])

    resp = client.post(URL, json=cuerpo)

    assert resp.status_code == 400
    assert db_session.query(Asistencia).count() == 0


def test_lote_reporta_quien_ya_registro_a_un_alumno_y_completa_el_resto(client, db_session):
    horario, alumnos, fecha = _escenario(client, 3)
    primero = client.post(URL, json=_cuerpo(horario, fecha, alumnos[:1]))
    assert primero.json()["creados"] == 1

    resp = client.post(URL, json=_cuerpo(horario, fecha, alumnos, estado="AUSENTE"))

    cuerpo = resp.json()
    assert cuerpo["creados"] == 2
    assert [f["personaId"] for f in cuerpo["fallidos"]] == [alumnos[0]["id"]]
    assert cuerpo["fallidos"][0]["registradoPorNombre"] == "Autor Torres"
    assert cuerpo["fallidos"][0]["yaRegistrada"] is True
    assert "ya fue registrada" in cuerpo["fallidos"][0]["motivo"]
    assert db_session.query(Asistencia).count() == 3


def test_lote_valida_horario_y_dia_una_sola_vez_para_todo_el_lote(client, db_session):
    horario, alumnos, _ = _escenario(client, 2)
    martes = str(ultima_fecha_en("MARTES"))

    en_dia_equivocado = client.post(URL, json=_cuerpo(horario, martes, alumnos))
    inexistente = client.post(
        URL, json={**_cuerpo(horario, martes, alumnos), "horario_id": 99999},
    )

    assert en_dia_equivocado.status_code == 400
    assert inexistente.status_code == 404
    assert db_session.query(Asistencia).count() == 0


def test_lote_vacio_se_rechaza_con_422(client):
    horario, _, fecha = _escenario(client, 1)

    resp = client.post(URL, json=_cuerpo(horario, fecha, []))

    assert resp.status_code == 422


def test_lote_exige_rol_de_staff(client_sin_permisos):
    resp = client_sin_permisos.post(
        URL, json={"horario_id": 1, "fecha": "2026-10-01", "items": []},
    )

    assert resp.status_code == 403


# --- ENT-02: ventana de fechas (hoy y hasta 30 días atrás, hora del club) ----
# `hoy_club` fijado al miércoles 2026-10-07: el límite (-30 días) es el lunes
# 2026-09-07, y el lunes anterior (2026-08-31) ya queda fuera.
_HOY = date(2026, 10, 7)


def _con_hoy_fijo(monkeypatch):
    monkeypatch.setattr(servicio_asistencia, "hoy_club", lambda: _HOY)


def test_lote_rechaza_fecha_futura(client, monkeypatch, db_session):
    _con_hoy_fijo(monkeypatch)
    horario, alumnos, _ = _escenario(client, 1)

    resp = client.post(URL, json=_cuerpo(horario, "2026-10-12", alumnos))  # lunes futuro

    assert resp.status_code == 400
    assert "futura" in resp.text
    assert db_session.query(Asistencia).count() == 0


def test_lote_rechaza_hace_mas_de_30_dias_y_acepta_el_limite(client, monkeypatch):
    _con_hoy_fijo(monkeypatch)
    horario, alumnos, _ = _escenario(client, 1)

    demasiado_viejo = client.post(URL, json=_cuerpo(horario, "2026-08-31", alumnos))
    en_el_limite = client.post(URL, json=_cuerpo(horario, "2026-09-07", alumnos))

    assert demasiado_viejo.status_code == 400
    assert "30 días" in demasiado_viejo.text
    assert en_el_limite.status_code == 201, en_el_limite.text


def test_lote_acepta_el_dia_de_hoy(client, monkeypatch):
    _con_hoy_fijo(monkeypatch)
    horario, alumnos, _ = _escenario(client, 1)
    miercoles = client.post(
        "/api/v1/asistencias/horarios",
        json={"categoria": "JUVENIL", "dia_semana": "MIERCOLES"},
    ).json()
    client.post(
        "/api/v1/asistencias/asignar-alumno",
        json={"persona_id": alumnos[0]["id"], "horario_id": miercoles["id"]},
    )

    resp = client.post(URL, json=_cuerpo(miercoles, str(_HOY), alumnos))

    assert resp.status_code == 201, resp.text


def test_registro_individual_aplica_la_misma_ventana(client, monkeypatch):
    _con_hoy_fijo(monkeypatch)
    horario, alumnos, _ = _escenario(client, 1)

    def registrar(fecha):
        return client.post(
            "/api/v1/asistencias/",
            json={
                "fecha_entrenamiento": fecha, "estado": "PRESENTE",
                "persona_id": alumnos[0]["id"], "horario_id": horario["id"],
            },
        )

    assert registrar("2026-10-12").status_code == 400
    assert registrar("2026-08-31").status_code == 400
    assert registrar("2026-09-07").status_code == 201
