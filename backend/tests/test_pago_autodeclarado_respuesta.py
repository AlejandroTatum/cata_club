"""`PagoResponse` expone `autodeclarado` (#1779).

La UI ofrece reemplazar un efectivo pendiente solo si lo declaró el propio
socio (`autodeclarado` True); un pendiente registrado por un administrador, o
anterior a la columna (NULL), nunca se reemplaza. El campo siempre es un
booleano en la respuesta: el NULL del origen desconocido sale como `false`, que
es como lo trata la regla del servidor.
"""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.dominio.enums import EstadoPago, TipoPago
from app.dominio.modelos import Pago
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.membresia_pago_servicio import MENSAJE_PAGO_PENDIENTE_DUPLICADO
from app.soporte_transversal.tiempo import hoy_club
from tests.arnes_bloqueo_impago import agregar_pago, crear_miembro, fijar_lanzamiento

URL_PAGOS = "/api/v1/membresias/pagos"


@pytest.fixture(autouse=True)
def _lanzamiento_lejano(monkeypatch):
    fijar_lanzamiento(monkeypatch)


def _como(persona_id, roles):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _moroso(db_session):
    persona, membresia = crear_miembro(db_session, cubierto_hasta=hoy_club() - timedelta(days=10))
    db_session.commit()
    return persona, membresia


def _declarar(client, persona, membresia, tipo="EFECTIVO"):
    return client.post(URL_PAGOS, json={
        "meses": 1, "tipo_pago": tipo, "persona_id": persona.id, "membresia_id": membresia.id,
    })


def _listado(client, persona):
    resp = client.get(f"{URL_PAGOS}/persona/{persona.id}")
    assert resp.status_code == 200, resp.text
    return {pago["id"]: pago for pago in resp.json()}


def test_el_efectivo_declarado_por_el_socio_sale_autodeclarado(client, db_session):
    persona, membresia = _moroso(db_session)
    _como(persona.id, ["ALUMNO"])

    creado = _declarar(client, persona, membresia)

    assert creado.status_code == 201, creado.text
    assert creado.json()["autodeclarado"] is True
    assert _listado(client, persona)[creado.json()["id"]]["autodeclarado"] is True


def test_el_pendiente_registrado_por_un_administrador_sale_no_autodeclarado(client, db_session):
    persona, membresia = _moroso(db_session)
    _como(1, ["ADMINISTRADOR"])

    creado = _declarar(client, persona, membresia)

    assert creado.status_code == 201, creado.text
    assert creado.json()["autodeclarado"] is False
    assert _listado(client, persona)[creado.json()["id"]]["autodeclarado"] is False


def test_un_pago_anterior_a_la_columna_sale_no_autodeclarado_y_no_se_toca(client, db_session):
    persona, membresia = _moroso(db_session)
    heredado = agregar_pago(
        db_session, persona, membresia, EstadoPago.PENDIENTE_VALIDACION, tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=hoy_club(), fecha_fin=hoy_club() + timedelta(days=30),
    )
    db_session.commit()
    _como(1, ["ADMINISTRADOR"])

    pago = _listado(client, persona)[heredado.id]

    assert pago["autodeclarado"] is False
    db_session.expire_all()
    assert db_session.scalar(select(Pago.autodeclarado).where(Pago.id == heredado.id)) is None


def test_el_pendiente_no_autodeclarado_sigue_rechazando_el_reemplazo(client, db_session):
    """El dato que expone el campo es el mismo que decide el servidor: sin
    `autodeclarado`, declarar otro pendiente es el 400 de siempre y no cambia nada."""
    persona, membresia = _moroso(db_session)
    _como(1, ["ADMINISTRADOR"])
    assert _declarar(client, persona, membresia).status_code == 201
    _como(persona.id, ["ALUMNO"])

    resp = _declarar(client, persona, membresia, "TRANSFERENCIA")

    assert resp.status_code == 400
    assert resp.json()["detail"] == MENSAJE_PAGO_PENDIENTE_DUPLICADO
    db_session.expire_all()
    assert [
        (p.estado_pago, p.tipo_pago) for p in db_session.scalars(select(Pago))
        if p.estado_pago != EstadoPago.APROBADO  # el aprobado lo siembra `crear_miembro`
    ] == [(EstadoPago.PENDIENTE_VALIDACION, TipoPago.EFECTIVO)]
