"""API-05 (QA3): un id de ruta fuera del rango int32 (o cualquier `DataError`
de la base) debe dar 422 con mensaje genérico en castellano, nunca un 500 ni
el detalle de PostgreSQL en el cuerpo."""
import logging

import pytest

_ID_FUERA_DE_RANGO = 99999999999


@pytest.mark.parametrize("metodo,ruta,cuerpo", [
    ("get", f"/api/v1/personas/{_ID_FUERA_DE_RANGO}", None),
    ("patch", f"/api/v1/personas/{_ID_FUERA_DE_RANGO}", {"nombres": "Ana"}),
])
def test_id_fuera_de_rango_responde_422_generico(client, caplog, metodo, ruta, cuerpo):
    with caplog.at_level(logging.ERROR):
        respuesta = getattr(client, metodo)(ruta, **({"json": cuerpo} if cuerpo else {}))

    assert respuesta.status_code == 422
    mensaje = respuesta.json()["message"]
    assert "Uno de los valores enviados no es válido" in mensaje
    for fuga in ("integer", "out of range", "psycopg", "SELECT", "SQL"):
        assert fuga not in respuesta.text
    assert any("DataError" in r.getMessage() for r in caplog.records)


def test_la_aplicacion_sigue_sirviendo_tras_un_data_error(client):
    client.get(f"/api/v1/personas/{_ID_FUERA_DE_RANGO}")
    assert client.get("/health").status_code == 200
