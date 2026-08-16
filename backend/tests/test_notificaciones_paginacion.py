"""
Paginación del feed de notificaciones in-app (issue #281).

`GET /api/v1/ranking/notificaciones/mias` devuelve ahora un envelope
`{items, total, skip, limit}` en lugar de la lista completa. Cubre los DOS
caminos de lectura:

- `listar_propias` (token sin REPRESENTANTE) → `NotificacionRepositorio`.
- `listar_para_persona_y_hijos` (token con REPRESENTANTE) → query inline del
  servicio, con el mismo desempate determinista `fecha_creacion desc, id desc`.

Las notificaciones se siembran directo por ORM para controlar `fecha_creacion`
(y ejercitar el desempate por id cuando varias comparten la misma fecha), igual
que `test_baja_logica_persona.py`.
"""
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.dominio.enums import TipoNotificacion
from app.dominio.modelos import Notificacion, Persona
from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app


FECHA = datetime(2029, 1, 1, tzinfo=timezone.utc)


def _crear_persona(db_session, cedula: str = "1710034065") -> Persona:
    persona = Persona(
        nombres="Ana", apellidos="Vega", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _crear_notificaciones(db_session, persona_id: int, mensajes: list[str], fecha=None) -> None:
    """Siembra una notificación por mensaje, todas con la MISMA fecha (o la
    `fecha` provista) para que el orden entre ellas dependa solo del desempate
    por id."""
    db_session.add_all([
        Notificacion(
            tipo=TipoNotificacion.PAGO_APROBADO,
            mensaje=mensaje,
            persona_id=persona_id,
            fecha_creacion=fecha or FECHA,
        )
        for mensaje in mensajes
    ])
    db_session.commit()


def _client_como(db_session, persona_id: int, roles: list[str]) -> TestClient:
    """Cliente autenticado con `persona_id`/`roles` arbitrarios (mismo idiom que
    `test_baja_logica_persona.py::_client_como`) para ejercitar el camino del
    representante, que el router ramifica según el rol REPRESENTANTE del token."""
    def _sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "test@cataclub.test", "persona_id": persona_id, "roles": roles,
    }
    return TestClient(app)


def _mensajes(body: dict) -> list[str]:
    return [n["mensaje"] for n in body["items"]]


class TestFeedNotificacionesPaginado:
    def test_contrato_respuesta_expone_items_total_skip_limit(self, client, db_session):
        persona = _crear_persona(db_session)
        _crear_notificaciones(db_session, persona.id, ["n1", "n2"])

        respuesta = client.get("/api/v1/ranking/notificaciones/mias")

        assert respuesta.status_code == 200
        body = respuesta.json()
        assert set(body.keys()) == {"items", "total", "skip", "limit"}
        assert body["total"] == 2
        assert body["skip"] == 0
        assert body["limit"] == 20

    def test_total_y_skip_limit_se_aplican_en_la_consulta(self, client, db_session):
        persona = _crear_persona(db_session)
        _crear_notificaciones(db_session, persona.id, ["n1", "n2", "n3", "n4", "n5"])

        respuesta = client.get(
            "/api/v1/ranking/notificaciones/mias",
            params={"skip": 1, "limit": 2},
        )

        assert respuesta.status_code == 200
        body = respuesta.json()
        assert body["total"] == 5
        assert body["skip"] == 1
        assert body["limit"] == 2
        # Desempate id desc: ids 5,4,3,2,1 → página skip=1 es [4, 3].
        assert _mensajes(body) == ["n4", "n3"]

    @pytest.mark.parametrize(
        "params",
        [{"limit": 201}, {"limit": 0}, {"skip": -1}],
        ids=["limit-201", "limit-0", "skip-negativo"],
    )
    def test_limites_fuera_de_rango_dan_422(self, client, db_session, params):
        persona = _crear_persona(db_session)
        _crear_notificaciones(db_session, persona.id, ["n1"])

        respuesta = client.get("/api/v1/ranking/notificaciones/mias", params=params)

        assert respuesta.status_code == 422

    def test_paginas_consecutivas_no_repiten_con_misma_fecha(self, client, db_session):
        persona = _crear_persona(db_session)
        _crear_notificaciones(db_session, persona.id, ["n1", "n2", "n3", "n4", "n5"])

        pagina1 = client.get(
            "/api/v1/ranking/notificaciones/mias", params={"skip": 0, "limit": 2}
        ).json()
        pagina2 = client.get(
            "/api/v1/ranking/notificaciones/mias", params={"skip": 2, "limit": 2}
        ).json()

        ids1 = [n["id"] for n in pagina1["items"]]
        ids2 = [n["id"] for n in pagina2["items"]]
        # Misma fecha en todas: el desempate por id desc garantiza que las dos
        # páginas no comparten ningún elemento.
        assert ids1 == [5, 4]
        assert ids2 == [3, 2]
        assert set(ids1).isdisjoint(ids2)


class TestFeedNotificacionesRepresentante:
    def test_representante_pagina_su_feed_y_el_de_sus_hijos(self, db_session):
        representante = _crear_persona(db_session, cedula="1710034065")
        hijo = _crear_persona(db_session, cedula="1710034073")
        hijo.representante_id = representante.id
        db_session.commit()
        _crear_notificaciones(db_session, representante.id, ["propia"])
        _crear_notificaciones(db_session, hijo.id, ["del hijo"])

        try:
            with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
                respuesta = c.get("/api/v1/ranking/notificaciones/mias")
        finally:
            app.dependency_overrides.clear()

        assert respuesta.status_code == 200
        body = respuesta.json()
        assert body["total"] == 2
        assert set(_mensajes(body)) == {"propia", "del hijo"}

    def test_representante_paginacion_con_desempate(self, db_session):
        representante = _crear_persona(db_session, cedula="1710034065")
        hijo = _crear_persona(db_session, cedula="1710034073")
        hijo.representante_id = representante.id
        db_session.commit()
        # Cuatro notificaciones con la misma fecha: el desempate por id es lo
        # único que define el orden entre páginas.
        _crear_notificaciones(db_session, representante.id, ["r1", "r2"])
        _crear_notificaciones(db_session, hijo.id, ["h1", "h2"])

        try:
            with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
                pagina1 = c.get(
                    "/api/v1/ranking/notificaciones/mias", params={"skip": 0, "limit": 2}
                ).json()
                pagina2 = c.get(
                    "/api/v1/ranking/notificaciones/mias", params={"skip": 2, "limit": 2}
                ).json()
        finally:
            app.dependency_overrides.clear()

        assert pagina1["total"] == 4
        assert pagina2["total"] == 4
        ids1 = [n["id"] for n in pagina1["items"]]
        ids2 = [n["id"] for n in pagina2["items"]]
        assert ids1 == [4, 3]
        assert ids2 == [2, 1]
        assert set(ids1).isdisjoint(ids2)
