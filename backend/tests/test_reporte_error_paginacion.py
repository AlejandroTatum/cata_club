"""Bandeja de errores reportados paginada: ninguna fila queda oculta en silencio.

`GET /reportes-error/` devuelve el mismo envelope que `GET /personas/`
(`{items, total, skip, limit}`): `total` cuenta la bandeja completa, no la
página, así que la UI puede ofrecer un paginador real.
"""
from datetime import datetime, timedelta, timezone

from app.dominio.modelos import ReporteError

URL = "/api/v1/reportes-error/"
BASE = datetime(2029, 1, 1, tzinfo=timezone.utc)


def _sembrar(db_session, persona_id: int, cantidad: int) -> None:
    """`descripcion` numerada; el reporte N es N minutos más nuevo que el 1."""
    db_session.add_all([
        ReporteError(
            persona_id=persona_id, descripcion=f"reporte-{n}",
            fecha_creacion=BASE + timedelta(minutes=n),
        )
        for n in range(1, cantidad + 1)
    ])
    db_session.commit()


def test_respuesta_expone_envelope_con_total_de_toda_la_bandeja(client, db_session, persona_sin_usuario):
    _sembrar(db_session, persona_sin_usuario.id, 25)

    cuerpo = client.get(URL).json()

    assert cuerpo["total"] == 25
    assert cuerpo["skip"] == 0
    assert cuerpo["limit"] == 20
    assert len(cuerpo["items"]) == 20


def test_todas_las_paginas_son_alcanzables_sin_repetir_ni_perder(client, db_session, persona_sin_usuario):
    _sembrar(db_session, persona_sin_usuario.id, 25)

    primera = client.get(f"{URL}?skip=0&limit=20").json()
    segunda = client.get(f"{URL}?skip=20&limit=20").json()

    descripciones = [r["descripcion"] for r in primera["items"] + segunda["items"]]
    assert [r["descripcion"] for r in segunda["items"]] == [f"reporte-{n}" for n in range(5, 0, -1)]
    assert descripciones == [f"reporte-{n}" for n in range(25, 0, -1)]
    assert segunda["total"] == 25


def test_bandeja_vacia_devuelve_total_cero(client):
    assert client.get(URL).json() == {"items": [], "total": 0, "skip": 0, "limit": 20}
