"""
QA3 ADM-11: los nombres de descuentos, tarifas (tipos de membresía) y
categorías son únicos. Dos nombres son el mismo si coinciden tras recortar,
colapsar espacios internos y pasar a minúsculas (casefold); las tildes
DISTINGUEN. El valor guardado queda recortado y con espacios colapsados.
Un duplicado responde 409 con un mensaje claro.
"""
import pytest

from app.dominio.nombres_catalogo import clave_nombre, normalizar_nombre

RUTA_DESCUENTOS = "/api/v1/descuentos/"
RUTA_TIPOS = "/api/v1/membresias/tipos"
RUTA_CATEGORIAS = "/api/v1/asistencias/categorias"


def test_normalizar_nombre_recorta_y_colapsa_espacios():
    assert normalizar_nombre("  Beca   municipal \t ") == "Beca municipal"


def test_clave_nombre_ignora_mayusculas_pero_no_tildes():
    assert clave_nombre("BECA  Municipal") == clave_nombre("beca municipal")
    assert clave_nombre("Categoría") != clave_nombre("Categoria")


def _descuento(client, nombre, **extra):
    return client.post(RUTA_DESCUENTOS, json={"nombre": nombre, "porcentaje": "10", **extra})


def _tipo(client, nombre, precio="35.00"):
    return client.post(
        RUTA_TIPOS, json={"categoria": nombre, "precio": precio, "modalidad": "MENSUAL"},
    )


def _categoria(client, nombre, hora_inicio="09:00", hora_fin="10:00", dia="LUNES"):
    return client.post(
        RUTA_CATEGORIAS,
        json={"nombre": nombre, "hora_inicio": hora_inicio, "hora_fin": hora_fin, "dias": [dia]},
    )


# --- Descuentos --------------------------------------------------------------
@pytest.mark.parametrize("repetido", ["beca municipal", "  BECA   Municipal  "])
def test_descuento_duplicado_por_caso_o_espacios_da_409(client, repetido):
    assert _descuento(client, "Beca municipal").status_code == 201

    resp = _descuento(client, repetido)

    assert resp.status_code == 409
    assert "Ya existe un descuento" in resp.json()["detail"]


def test_descuento_con_tilde_distinta_no_es_duplicado(client):
    assert _descuento(client, "Beca única").status_code == 201
    assert _descuento(client, "Beca unica").status_code == 201


def test_descuento_guarda_el_nombre_normalizado(client):
    resp = _descuento(client, "  Beca    municipal ")

    assert resp.status_code == 201
    assert resp.json()["nombre"] == "Beca municipal"


def test_descuento_solo_espacios_da_422(client):
    assert _descuento(client, "    ").status_code == 422


def test_renombrar_descuento_a_un_nombre_existente_da_409(client):
    _descuento(client, "Beca municipal")
    otro = _descuento(client, "Familiar").json()

    resp = client.patch(f"{RUTA_DESCUENTOS}{otro['id']}", json={"nombre": "BECA municipal"})

    assert resp.status_code == 409


def test_renombrar_descuento_con_su_propio_nombre_en_otra_capitalizacion_es_valido(client):
    creado = _descuento(client, "Beca municipal").json()

    resp = client.patch(f"{RUTA_DESCUENTOS}{creado['id']}", json={"nombre": "BECA Municipal"})

    assert resp.status_code == 200
    assert resp.json()["nombre"] == "BECA Municipal"


# --- Tarifas (tipos de membresía) --------------------------------------------
def test_tarifa_duplicada_por_caso_o_espacios_da_409(client):
    assert _tipo(client, "Adultos mañana").status_code == 201

    resp = _tipo(client, " adultos   MAÑANA")

    assert resp.status_code == 409
    assert "Ya existe una tarifa" in resp.json()["detail"]


def test_tarifa_con_tilde_distinta_no_es_duplicado(client):
    assert _tipo(client, "Mañana").status_code == 201
    assert _tipo(client, "Manana").status_code == 201


def test_tarifa_guarda_el_nombre_normalizado_y_rechaza_vacio(client):
    resp = _tipo(client, "  Adultos    tarde ")
    assert resp.status_code == 201
    assert resp.json()["categoria"] == "Adultos tarde"
    assert _tipo(client, "   ").status_code == 422


def test_renombrar_tarifa_a_un_nombre_existente_da_409(client):
    _tipo(client, "Adultos")
    otra = _tipo(client, "Niños").json()

    resp = client.patch(f"{RUTA_TIPOS}/{otra['id']}", json={"categoria": "ADULTOS"})

    assert resp.status_code == 409


# --- Categorías --------------------------------------------------------------
def test_categoria_duplicada_por_caso_o_espacios_da_409(client):
    assert _categoria(client, "Pre infantil").status_code == 201

    resp = _categoria(client, "  pre   INFANTIL ", hora_inicio="11:00", hora_fin="12:00")

    assert resp.status_code == 409
    assert "Ya existe una categoría" in resp.json()["detail"]


def test_categoria_con_tilde_distinta_no_es_duplicado(client):
    assert _categoria(client, "Categoría").status_code == 201
    assert _categoria(client, "Categoria", hora_inicio="11:00", hora_fin="12:00").status_code == 201


def test_categoria_guarda_el_nombre_normalizado(client):
    resp = _categoria(client, "  Pre    infantil ")

    assert resp.status_code == 201
    assert resp.json()["label"] == "Pre infantil"


def test_renombrar_categoria_a_un_nombre_existente_da_409(client):
    _categoria(client, "Pre infantil")
    otra = _categoria(client, "Cadetes especiales", hora_inicio="11:00", hora_fin="12:00")
    assert otra.status_code == 201, otra.text
    otra = otra.json()

    resp = client.put(f"{RUTA_CATEGORIAS}/{otra['codigo']}", json={"nombre": "PRE  infantil"})

    assert resp.status_code == 409
