"""Bloqueo por impago en el portal y en `GET /auth/me` (#1768, S6 backend).

El backend solo EXPONE el hecho (bandera por perfil + fin de cobertura para el
banner); la restricción del portal a Pagos es ruteo del frontend.
"""
from datetime import timedelta

import pytest

from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago, TipoRol
from app.soporte_transversal.tiempo import hoy_club
from tests.arnes_bloqueo_impago import agregar_pago, crear_miembro, fijar_lanzamiento
from tests.fabricas_pagos import crear_persona_orm
from tests.test_auth_activation import _crear_usuario, _token
from tests.test_portal_alumno import URL, _como, _familia


@pytest.fixture(autouse=True)
def _lanzamiento_lejano(monkeypatch):
    fijar_lanzamiento(monkeypatch)


def _hoy_menos(dias):
    return hoy_club() - timedelta(days=dias)


# --- Portal: bandera por perfil ------------------------------------------------------------
def test_el_portal_marca_solo_al_hijo_vencido_y_da_la_fecha_del_banner(client, db_session):
    padre = crear_persona_orm(db_session, "1710034065", nombres="Pat", apellidos="Padre")
    al_dia, _ = crear_miembro(
        db_session, cubierto_hasta=hoy_club() + timedelta(days=9),
        estado=EstadoMembresia.ACTIVA, representante=padre, nombres="Alba",
    )
    moroso, _ = crear_miembro(
        db_session, cubierto_hasta=_hoy_menos(10), representante=padre, nombres="Moro",
    )
    db_session.commit()
    _como(padre.id, ["REPRESENTANTE"])

    cuerpo = client.get(f"{URL}/{padre.id}").json()

    por_id = {p["persona"]["id"]: p for p in cuerpo["representados"]}
    assert por_id[moroso.id]["bloqueadoPorImpago"] is True
    assert por_id[moroso.id]["cubiertoHasta"] == _hoy_menos(10).isoformat()
    assert por_id[al_dia.id]["bloqueadoPorImpago"] is False
    assert cuerpo["titular"]["bloqueadoPorImpago"] is False


def test_el_portal_marca_tambien_al_titular_bloqueado(client, db_session):
    titular, _ = crear_miembro(db_session, cubierto_hasta=_hoy_menos(10))
    db_session.commit()
    _como(titular.id, ["ALUMNO"])

    cuerpo = client.get(f"{URL}/{titular.id}").json()

    assert cuerpo["titular"]["bloqueadoPorImpago"] is True
    assert cuerpo["titular"]["cubiertoHasta"] == _hoy_menos(10).isoformat()


def test_en_el_portal_la_transferencia_pendiente_con_comprobante_desbloquea_al_hijo(client, db_session):
    padre = crear_persona_orm(db_session, "1710034065", nombres="Pat", apellidos="Padre")
    hijo, membresia = crear_miembro(db_session, cubierto_hasta=_hoy_menos(10), representante=padre)
    agregar_pago(
        db_session, hijo, membresia, EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.TRANSFERENCIA, con_voucher=True,
        fecha_inicio=hoy_club(), fecha_fin=hoy_club() + timedelta(days=30),
    )
    db_session.commit()
    _como(padre.id, ["REPRESENTANTE"])

    cuerpo = client.get(f"{URL}/{padre.id}").json()

    assert cuerpo["representados"][0]["bloqueadoPorImpago"] is False


def test_el_portal_conserva_su_forma_y_nadie_figura_bloqueado_con_el_bloqueo_apagado(
    client, db_session, monkeypatch,
):
    """Regresión: el payload de siempre sigue completo, y sin fecha de
    lanzamiento ningún perfil queda bloqueado aunque su cobertura sea vieja."""
    fijar_lanzamiento(monkeypatch, None)
    padre, hijos, _, _ = _familia(db_session, base=7100)
    _como(padre.id, ["REPRESENTANTE"])

    cuerpo = client.get(f"{URL}/{padre.id}").json()

    assert cuerpo["titular"]["persona"]["id"] == padre.id
    assert len(cuerpo["representados"]) == 2
    assert {"horarios", "tipos"} <= set(cuerpo)
    perfiles = [cuerpo["titular"], *cuerpo["representados"]]
    assert all({"historial", "membresias", "historialTotal"} <= set(p) for p in perfiles)
    assert [p["bloqueadoPorImpago"] for p in perfiles] == [False, False, False]
    assert [p["cubiertoHasta"] for p in perfiles] == [None, None, None]


# --- GET /auth/me ---------------------------------------------------------------------------------
def _me(client_sin_token, usuario):
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {_token(usuario)}"},
    )
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def test_me_expone_el_bloqueo_propio_y_el_fin_de_cobertura(client_sin_token, db_session):
    usuario = _crear_usuario(
        db_session, correo="moroso-me@cataclub.test", correo_verificado=True,
        estado_membresia=EstadoMembresia.VENCIDA,
    )
    membresia = usuario.persona.membresias[0]
    agregar_pago(
        db_session, usuario.persona, membresia, EstadoPago.APROBADO,
        fecha_inicio=_hoy_menos(40), fecha_fin=_hoy_menos(10),
    )
    db_session.commit()

    me = _me(client_sin_token, usuario)

    assert me["bloqueadoPorImpago"] is True
    assert me["cubiertoHasta"] == _hoy_menos(10).isoformat()


@pytest.mark.parametrize("rol", [TipoRol.ALUMNO, TipoRol.ADMINISTRADOR])
def test_me_de_quien_esta_al_dia_o_no_tiene_membresia_no_esta_bloqueado(client_sin_token, db_session, rol):
    sin_membresia = _crear_usuario(
        db_session, correo=f"sin-membresia-{rol.value}@cataclub.test", correo_verificado=True, rol=rol,
    )

    me = _me(client_sin_token, sin_membresia)

    assert me["bloqueadoPorImpago"] is False
    assert me["cubiertoHasta"] is None
    assert me["puedeEntrenar"] is False  # el resto del contrato no cambia


def test_me_con_el_bloqueo_apagado_no_marca_a_un_vencido(client_sin_token, db_session, monkeypatch):
    fijar_lanzamiento(monkeypatch, None)
    usuario = _crear_usuario(
        db_session, correo="vencido-apagado@cataclub.test", correo_verificado=True,
        estado_membresia=EstadoMembresia.VENCIDA,
    )
    agregar_pago(
        db_session, usuario.persona, usuario.persona.membresias[0], EstadoPago.APROBADO,
        fecha_inicio=_hoy_menos(90), fecha_fin=_hoy_menos(60),
    )
    db_session.commit()

    me = _me(client_sin_token, usuario)

    assert me["bloqueadoPorImpago"] is False
    assert me["puedeEntrenar"] is True
