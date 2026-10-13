"""
Issue #1749: «Miembro desde» -- mes y año que el club tiene registrados para
un JUGADOR, fijados por un administrador (`PATCH /personas/{id}/miembro-desde`)
y mostrados en el carnet y en el perfil del portal.

Almacenamiento: `persona.miembro_desde` es un `DATE` fijado SIEMPRE al día 1
del mes (el día no se inventa ni se expone como dato: solo importan mes y
año). Vacío = `NULL` = no se muestra nada; nunca se deriva de
`fecha_registro` ni de la activación de una membresía.
"""
from datetime import date, datetime, timezone

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia
from app.dominio.reglas_negocio import FECHA_FUNDACION_CLUB
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm,
)

HOY = date(2026, 10, 12)
URL = "/api/v1/personas"
PORTAL = "/api/v1/portal/alumno"


@pytest.fixture(autouse=True)
def _hoy_fijo(monkeypatch):
    """El conftest congela `hoy_club` en 2029; acá se fija un día propio para
    que el borde «mes actual / mes siguiente» no dependa de ese valor."""
    import app.servicios_negocio.persona_servicio as ps
    monkeypatch.setattr(ps, "hoy_club", lambda: HOY)


def _jugador(db_session, base=8000, estado=EstadoMembresia.ACTIVA):
    persona = crear_persona_orm(db_session, cedula_valida(base))
    crear_membresia_orm(db_session, persona, crear_tipo_membresia_orm(db_session), estado)
    db_session.commit()
    return persona


def _fijar(client, persona_id, valor):
    return client.patch(f"{URL}/{persona_id}/miembro-desde", json={"miembro_desde": valor})


def _mes_siguiente(hoy: date) -> date:
    return date(hoy.year + (hoy.month == 12), hoy.month % 12 + 1, 1)


def test_fijar_guarda_mes_y_anio_con_el_dia_en_uno(client, db_session):
    jugador = _jugador(db_session)

    resp = _fijar(client, jugador.id, "2019-03-17")

    assert resp.status_code == 200
    assert resp.json()["miembroDesde"] == "2019-03-01"
    db_session.refresh(jugador)
    assert jugador.miembro_desde == date(2019, 3, 1)


def test_reemplazar_el_valor_y_limpiarlo(client, db_session):
    jugador = _jugador(db_session)
    _fijar(client, jugador.id, "2019-03-01")

    assert _fijar(client, jugador.id, "2020-11-01").json()["miembroDesde"] == "2020-11-01"
    limpiado = _fijar(client, jugador.id, None)

    assert limpiado.status_code == 200
    assert limpiado.json()["miembroDesde"] is None
    db_session.refresh(jugador)
    assert jugador.miembro_desde is None


def test_un_jugador_con_membresia_vencida_tambien_puede_tenerlo(client, db_session):
    jugador = _jugador(db_session, estado=EstadoMembresia.VENCIDA)

    assert _fijar(client, jugador.id, "2019-03-01").status_code == 200


def test_el_mes_actual_se_acepta_y_el_siguiente_no(client, db_session):
    jugador = _jugador(db_session)
    hoy = HOY

    assert _fijar(client, jugador.id, hoy.isoformat()).status_code == 200
    futuro = _fijar(client, jugador.id, _mes_siguiente(hoy).isoformat())

    assert futuro.status_code == 400
    assert "futuro" in futuro.json()["detail"].lower()
    db_session.refresh(jugador)
    assert jugador.miembro_desde == hoy.replace(day=1)


def test_antes_de_la_fundacion_se_rechaza_y_el_mes_de_fundacion_se_acepta(client, db_session):
    jugador = _jugador(db_session)

    antes = _fijar(client, jugador.id, date(FECHA_FUNDACION_CLUB.year, FECHA_FUNDACION_CLUB.month - 1, 28).isoformat())
    mes_fundacion = _fijar(client, jugador.id, FECHA_FUNDACION_CLUB.replace(day=1).isoformat())

    assert antes.status_code == 400
    assert "fundaci" in antes.json()["detail"].lower()
    assert mes_fundacion.status_code == 200


def test_la_fecha_de_fundacion_es_el_10_de_octubre_de_2013():
    assert FECHA_FUNDACION_CLUB == date(2013, 10, 10)


def test_cuerpo_sin_el_campo_es_422(client, db_session):
    jugador = _jugador(db_session)

    assert client.patch(f"{URL}/{jugador.id}/miembro-desde", json={}).status_code == 422
    assert _fijar(client, jugador.id, "marzo 2019").status_code == 422


def test_no_jugador_se_rechaza_con_mensaje_claro(client, db_session):
    staff = crear_persona_orm(db_session, cedula_valida(8100))
    db_session.commit()

    resp = _fijar(client, staff.id, "2019-03-01")

    assert resp.status_code == 400
    assert "jugador" in resp.json()["detail"].lower()
    db_session.refresh(staff)
    assert staff.miembro_desde is None


def test_persona_inexistente_es_404(client):
    assert _fijar(client, 999999, "2019-03-01").status_code == 404


def test_un_no_administrador_recibe_403(client_sin_permisos, db_session):
    jugador = _jugador(db_session)

    assert _fijar(client_sin_permisos, jugador.id, "2019-03-01").status_code == 403
    db_session.refresh(jugador)
    assert jugador.miembro_desde is None


def test_el_propio_jugador_tampoco_puede_fijarlo(client, db_session):
    jugador = _jugador(db_session)
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "j@cataclub.test", "persona_id": jugador.id, "roles": ["ALUMNO"],
    }

    assert _fijar(client, jugador.id, "2019-03-01").status_code == 403


def test_el_portal_expone_el_valor_o_null_sin_inventar_nada(client, db_session):
    jugador = _jugador(db_session, base=8200)
    jugador.fecha_registro = datetime(2024, 5, 20, tzinfo=timezone.utc)
    db_session.commit()

    vacio = client.get(f"{PORTAL}/{jugador.id}").json()["titular"]["persona"]
    _fijar(client, jugador.id, "2019-03-01")
    fijado = client.get(f"{PORTAL}/{jugador.id}").json()["titular"]["persona"]

    assert vacio["miembroDesde"] is None
    assert fijado["miembroDesde"] == "2019-03-01"


def test_persona_nace_sin_miembro_desde(db_session):
    persona = crear_persona_orm(db_session, cedula_valida(8300))
    db_session.commit()

    assert persona.miembro_desde is None


@pytest.mark.parametrize("ruta", [f"{URL}/{{id}}"])
def test_get_persona_incluye_el_campo(client, db_session, ruta):
    jugador = _jugador(db_session, base=8400)
    _fijar(client, jugador.id, "2021-07-01")

    assert client.get(ruta.format(id=jugador.id)).json()["miembroDesde"] == "2021-07-01"
