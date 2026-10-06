"""API de días sin clase (issue #1665): solo el admin escribe, los socios leen."""
from datetime import date

from app.dominio.modelos import DiaSinClase

RUTA = "/api/v1/dias-sin-clase/"


def _payload(**extra):
    return {"fecha_inicio": "2029-07-04", "motivo": "Feriado", **extra}


def test_admin_crea_un_dia_sin_clase_de_un_solo_dia(client):
    response = client.post(RUTA, json=_payload())

    assert response.status_code == 201
    cuerpo = response.json()
    assert cuerpo["fechaInicio"] == "2029-07-04"
    assert cuerpo["fechaFin"] == "2029-07-04"
    assert cuerpo["motivo"] == "Feriado"


def test_admin_crea_un_rango_y_recorta_el_motivo(client):
    response = client.post(RUTA, json=_payload(fecha_fin="2029-07-06", motivo="  Cancha cerrada  "))

    assert response.status_code == 201
    assert response.json()["fechaFin"] == "2029-07-06"
    assert response.json()["motivo"] == "Cancha cerrada"


def test_rechaza_rango_invertido_y_motivo_vacio(client):
    invertido = client.post(RUTA, json=_payload(fecha_fin="2029-07-03"))
    vacio = client.post(RUTA, json=_payload(motivo="   "))

    assert invertido.status_code == 422
    assert vacio.status_code == 422


def test_admin_edita_un_dia_sin_clase(client):
    creado = client.post(RUTA, json=_payload()).json()

    response = client.put(
        f"{RUTA}{creado['id']}", json={"fecha_inicio": "2029-07-05", "motivo": "Evento del club"},
    )

    assert response.status_code == 200
    assert response.json()["fechaInicio"] == "2029-07-05"
    assert response.json()["fechaFin"] == "2029-07-05"
    assert response.json()["motivo"] == "Evento del club"


def test_admin_elimina_un_dia_sin_clase(client, db_session):
    creado = client.post(RUTA, json=_payload()).json()

    assert client.delete(f"{RUTA}{creado['id']}").status_code == 204

    assert db_session.get(DiaSinClase, creado["id"]) is None


def test_editar_o_borrar_un_id_inexistente_da_404(client):
    assert client.put(f"{RUTA}999999", json=_payload()).status_code == 404
    assert client.delete(f"{RUTA}999999").status_code == 404


def test_un_socio_no_puede_crear_editar_ni_borrar(client, client_sin_permisos, db_session):
    dia = DiaSinClase(fecha_inicio=date(2029, 7, 4), fecha_fin=date(2029, 7, 4), motivo="Feriado")
    db_session.add(dia)
    db_session.flush()
    # `client` y `client_sin_permisos` comparten overrides: el último gana, que
    # es el socio sin rol de administrador.

    assert client_sin_permisos.post(RUTA, json=_payload()).status_code == 403
    assert client_sin_permisos.put(f"{RUTA}{dia.id}", json=_payload()).status_code == 403
    assert client_sin_permisos.delete(f"{RUTA}{dia.id}").status_code == 403
    assert db_session.get(DiaSinClase, dia.id).motivo == "Feriado"


def test_un_socio_puede_leer_y_filtrar_por_fecha(client_sin_permisos, db_session):
    db_session.add_all([
        DiaSinClase(fecha_inicio=date(2029, 7, 4), fecha_fin=date(2029, 7, 4), motivo="Pasado"),
        DiaSinClase(fecha_inicio=date(2029, 8, 1), fecha_fin=date(2029, 8, 3), motivo="Futuro"),
    ])
    db_session.flush()

    todos = client_sin_permisos.get(RUTA)
    desde = client_sin_permisos.get(RUTA, params={"desde": "2029-07-10"})
    tramo = client_sin_permisos.get(RUTA, params={"desde": "2029-08-02", "hasta": "2029-08-02"})

    assert [d["motivo"] for d in todos.json()] == ["Pasado", "Futuro"]
    assert [d["motivo"] for d in desde.json()] == ["Futuro"]
    assert [d["motivo"] for d in tramo.json()] == ["Futuro"]


def test_sin_token_no_hay_lectura_publica(client_sin_token):
    assert client_sin_token.get(RUTA).status_code in (401, 403)
