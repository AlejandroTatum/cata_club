"""
Autoservicio de lectura del beneficio personal (issue #400, slice 06).

`GET /personas/{persona_id}/beneficio` era ADMINISTRADOR-only (issue #398):
el socio no podía saber ANTES de pagar si tenía un beneficio vigente. Esta
suite fija la relajación de ESE único verbo -- mismo criterio de ownership ya
usado por `GET /membresias/pagos/persona/{persona_id}` (ver
`test_ownership_pagos.py`) y `GET /membresias/mias`: dueño, su representante,
o ADMINISTRADOR.

`POST`/`DELETE /personas/{persona_id}/beneficio` NO cambian -- siguen
ADMINISTRADOR-only, ya cubierto por `test_beneficio_asignacion.py`.
"""
from decimal import Decimal

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Descuento
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_pagos import crear_persona_orm

RUTA_BENEFICIO = "/api/v1/personas/{persona_id}/beneficio"


def _crear_descuento(sesion, *, nombre="Becado", porcentaje=Decimal("50.00")) -> Descuento:
    descuento = Descuento(nombre=nombre, porcentaje=porcentaje, activo=True)
    sesion.add(descuento)
    sesion.flush()
    return descuento


def _autenticar_como(persona_id, roles):
    """Mismo truco que `test_ownership_pagos.py`: sobrescribe el token del
    cliente de test ya autenticado por el fixture `client`."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def test_el_dueno_puede_leer_su_propio_beneficio(client, db_session):
    dueno = crear_persona_orm(db_session, cedula_valida(720))
    descuento = _crear_descuento(db_session)
    db_session.commit()

    # `client` (conftest) asigna como admin -- el beneficio existe antes de
    # que el dueño intente leerlo.
    asignado = client.post(
        RUTA_BENEFICIO.format(persona_id=dueno.id),
        json={"descuento_id": descuento.id},
    )
    assert asignado.status_code == 201, asignado.text

    _autenticar_como(dueno.id, ["ALUMNO"])
    resp = client.get(RUTA_BENEFICIO.format(persona_id=dueno.id))
    assert resp.status_code == 200, resp.text
    assert resp.json()["descuento"]["id"] == descuento.id


def test_el_representante_puede_leer_el_beneficio_de_su_representado(client, db_session):
    representante = crear_persona_orm(db_session, cedula_valida(721))
    hijo = crear_persona_orm(db_session, cedula_valida(722))
    hijo.representante_id = representante.id
    descuento = _crear_descuento(db_session, nombre="Becado hijo", porcentaje=Decimal("100.00"))
    db_session.commit()

    client.post(
        RUTA_BENEFICIO.format(persona_id=hijo.id),
        json={"descuento_id": descuento.id},
    )

    _autenticar_como(representante.id, ["REPRESENTANTE"])
    resp = client.get(RUTA_BENEFICIO.format(persona_id=hijo.id))
    assert resp.status_code == 200, resp.text
    assert resp.json()["descuento"]["id"] == descuento.id


def test_un_tercero_sin_vinculo_no_puede_leer_el_beneficio_ajeno(client, db_session):
    dueno = crear_persona_orm(db_session, cedula_valida(723))
    extrano = crear_persona_orm(db_session, cedula_valida(724))
    descuento = _crear_descuento(db_session)
    db_session.commit()

    client.post(
        RUTA_BENEFICIO.format(persona_id=dueno.id),
        json={"descuento_id": descuento.id},
    )

    _autenticar_como(extrano.id, ["ALUMNO"])
    resp = client.get(RUTA_BENEFICIO.format(persona_id=dueno.id))
    assert resp.status_code == 403, resp.text


def test_el_admin_sigue_pudiendo_leer_cualquier_beneficio(client, db_session):
    dueno = crear_persona_orm(db_session, cedula_valida(725))
    descuento = _crear_descuento(db_session)
    db_session.commit()

    resp = client.post(
        RUTA_BENEFICIO.format(persona_id=dueno.id),
        json={"descuento_id": descuento.id},
    )
    assert resp.status_code == 201, resp.text

    # Token del conftest: ADMINISTRADOR persona_id=1, distinto del dueño.
    leido = client.get(RUTA_BENEFICIO.format(persona_id=dueno.id))
    assert leido.status_code == 200
    assert leido.json()["descuento"]["id"] == descuento.id
