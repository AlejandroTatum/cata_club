"""
Tests del CRUD de geografía (Pais, Provincia, Canton).

Cubre:
  - Crear país (admin) -> 201.
  - Listar países no requiere rol específico -> 200, envelope paginado.
  - Crear provincia con pais_id válido (admin) -> 201.
  - Listar provincias con filtro `pais_id` -> solo las de ese país.
  - Crear cantón con provincia_id válido (admin) -> 201.
  - Listar cantones con filtro `provincia_id` -> solo los de esa provincia.
  - Crear provincia/cantón sin rol ADMINISTRADOR -> 403.
  - Crear provincia con pais_id inexistente -> 404.
  - Obtener país por id inexistente -> 404.
  - Paginación (`skip`/`limit`/`total`) y su validación, parametrizada sobre
    los tres endpoints (issue #814: los tres ya la exponían el repositorio y
    el servicio, pero el router nunca la cableó).
"""
import pytest

# Issue #814: (ruta, kwarg de factory a usar como filtro-en-blanco, key JSON
# del padre a inyectar como filtro, param name en la URL) -- ninguno de los
# tres endpoints necesita el filtro para el candado de paginación en sí, así
# que se listan sin filtrar.
_RUTAS_PAGINADAS = [
    "/api/v1/geografia/paises",
    "/api/v1/geografia/provincias",
    "/api/v1/geografia/cantones",
]


def test_crear_y_listar_paises(client):
    resp = client.post("/api/v1/geografia/paises", json={"nombre": "Ecuador"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["nombre"] == "Ecuador"
    pais_id = resp.json()["id"]

    resp2 = client.post("/api/v1/geografia/paises", json={"nombre": "Perú"})
    assert resp2.status_code == 201
    assert resp2.json()["id"] != pais_id

    listar = client.get("/api/v1/geografia/paises")
    assert listar.status_code == 200
    cuerpo = listar.json()
    assert cuerpo["skip"] == 0 and cuerpo["limit"] == 50
    nombres = [p["nombre"] for p in cuerpo["items"]]
    assert "Ecuador" in nombres
    assert "Perú" in nombres

    # Obtener por id:
    resp3 = client.get(f"/api/v1/geografia/paises/{pais_id}")
    assert resp3.status_code == 200
    assert resp3.json()["nombre"] == "Ecuador"


def test_obtener_pais_inexistente_da_404(client):
    resp = client.get("/api/v1/geografia/paises/9999")
    assert resp.status_code == 404


def test_crear_provincia_y_filtro_por_pais(client):
    pais = client.post("/api/v1/geografia/paises", json={"nombre": "Ecuador"}).json()
    otro_pais = client.post("/api/v1/geografia/paises", json={"nombre": "Colombia"}).json()

    resp = client.post(
        "/api/v1/geografia/provincias",
        json={"nombre": "Pichincha", "pais_id": pais["id"]},
    )
    assert resp.status_code == 201, resp.text
    pid = resp.json()["id"]

    # Provincia de Colombia para verificar que el filtro excluye:
    client.post(
        "/api/v1/geografia/provincias",
        json={"nombre": "Cundinamarca", "pais_id": otro_pais["id"]},
    )

    # Filtro por pais_id=Ecuador -> solo Pichincha:
    filtradas = client.get(f"/api/v1/geografia/provincias?pais_id={pais['id']}")
    assert filtradas.status_code == 200
    cuerpo_filtradas = filtradas.json()
    nombres = [p["nombre"] for p in cuerpo_filtradas["items"]]
    assert "Pichincha" in nombres
    assert "Cundinamarca" not in nombres
    assert cuerpo_filtradas["total"] == len(cuerpo_filtradas["items"])

    # Sin filtro -> todas:
    todas = client.get("/api/v1/geografia/provincias")
    assert todas.status_code == 200
    assert todas.json()["total"] >= 2

    # Obtener por id:
    obt = client.get(f"/api/v1/geografia/provincias/{pid}")
    assert obt.status_code == 200
    assert obt.json()["nombre"] == "Pichincha"


def test_crear_provincia_con_pais_inexistente_da_404(client):
    resp = client.post(
        "/api/v1/geografia/provincias",
        json={"nombre": "X", "pais_id": 9999},
    )
    assert resp.status_code == 404


def test_crear_canton_y_filtro_por_provincia(client):
    pais = client.post("/api/v1/geografia/paises", json={"nombre": "Ecuador"}).json()
    prov = client.post(
        "/api/v1/geografia/provincias",
        json={"nombre": "Pichincha", "pais_id": pais["id"]},
    ).json()
    otra_prov = client.post(
        "/api/v1/geografia/provincias",
        json={"nombre": "Guayas", "pais_id": pais["id"]},
    ).json()

    resp = client.post(
        "/api/v1/geografia/cantones",
        json={"nombre": "Quito", "provincia_id": prov["id"]},
    )
    assert resp.status_code == 201, resp.text
    cid = resp.json()["id"]

    # Cantón de Guayas para verificar exclusión en el filtro:
    client.post(
        "/api/v1/geografia/cantones",
        json={"nombre": "Guayaquil", "provincia_id": otra_prov["id"]},
    )

    filtrados = client.get(f"/api/v1/geografia/cantones?provincia_id={prov['id']}")
    assert filtrados.status_code == 200
    cuerpo_filtrados = filtrados.json()
    nombres = [c["nombre"] for c in cuerpo_filtrados["items"]]
    assert "Quito" in nombres
    assert "Guayaquil" not in nombres
    assert cuerpo_filtrados["total"] == len(cuerpo_filtrados["items"])

    # Obtener por id:
    obt = client.get(f"/api/v1/geografia/cantones/{cid}")
    assert obt.status_code == 200
    assert obt.json()["nombre"] == "Quito"


def test_crear_canton_con_provincia_inexistente_da_404(client):
    resp = client.post(
        "/api/v1/geografia/cantones",
        json={"nombre": "X", "provincia_id": 9999},
    )
    assert resp.status_code == 404


def test_crear_provincia_sin_rol_admin_da_403(client_sin_permisos):
    """El POST exige rol ADMINISTRADOR -> el conftest client_sin_permisos
    tiene rol ALUMNO y debe recibir 403."""
    # Necesitamos un país; lo creamos también como no-admin: también 403,
    # pero el test es sobre provincia; creamos el país directamente vía API
    # admin no es posible aquí, así que verificamos el 403 directo de provincia:
    resp = client_sin_permisos.post(
        "/api/v1/geografia/provincias",
        json={"nombre": "X", "pais_id": 1},
    )
    assert resp.status_code == 403


def test_crear_canton_sin_rol_admin_da_403(client_sin_permisos):
    resp = client_sin_permisos.post(
        "/api/v1/geografia/cantones",
        json={"nombre": "X", "provincia_id": 1},
    )
    assert resp.status_code == 403


def test_crear_pais_sin_rol_admin_da_403(client_sin_permisos):
    resp = client_sin_permisos.post(
        "/api/v1/geografia/paises",
        json={"nombre": "X"},
    )
    assert resp.status_code == 403


def test_listar_paises_no_requiere_rol_admin(client_sin_permisos):
    """GET es de lectura general; no requiere rol ADMINISTRADOR."""
    resp = client_sin_permisos.get("/api/v1/geografia/paises")
    assert resp.status_code == 200


# --- Paginación (issue #814) -------------------------------------------------
# Los tres endpoints comparten exactamente el mismo contrato de paginación
# (`skip`/`limit`/`total`), así que las pruebas se parametrizan sobre las tres
# rutas en vez de triplicar el mismo test.

def _sembrar_paises(client, cantidad):
    for i in range(cantidad):
        client.post("/api/v1/geografia/paises", json={"nombre": f"País {i}"})


def _sembrar_provincias(client, cantidad):
    pais = client.post("/api/v1/geografia/paises", json={"nombre": "Base"}).json()
    for i in range(cantidad):
        client.post(
            "/api/v1/geografia/provincias",
            json={"nombre": f"Provincia {i}", "pais_id": pais["id"]},
        )


def _sembrar_cantones(client, cantidad):
    pais = client.post("/api/v1/geografia/paises", json={"nombre": "Base"}).json()
    provincia = client.post(
        "/api/v1/geografia/provincias", json={"nombre": "Base", "pais_id": pais["id"]},
    ).json()
    for i in range(cantidad):
        client.post(
            "/api/v1/geografia/cantones",
            json={"nombre": f"Cantón {i}", "provincia_id": provincia["id"]},
        )


_SEMBRADORES = {
    "/api/v1/geografia/paises": _sembrar_paises,
    "/api/v1/geografia/provincias": _sembrar_provincias,
    "/api/v1/geografia/cantones": _sembrar_cantones,
}


@pytest.mark.parametrize("ruta", _RUTAS_PAGINADAS)
def test_paginacion_respeta_skip_limit_y_total(client, ruta):
    _SEMBRADORES[ruta](client, 3)

    primera_pagina = client.get(f"{ruta}?limit=2")
    assert primera_pagina.status_code == 200
    cuerpo_1 = primera_pagina.json()
    assert len(cuerpo_1["items"]) == 2
    assert cuerpo_1["total"] == 3
    assert cuerpo_1["skip"] == 0
    assert cuerpo_1["limit"] == 2

    segunda_pagina = client.get(f"{ruta}?skip=2&limit=2")
    assert segunda_pagina.status_code == 200
    cuerpo_2 = segunda_pagina.json()
    assert len(cuerpo_2["items"]) == 1
    assert cuerpo_2["total"] == 3
    ids_pagina_1 = {item["id"] for item in cuerpo_1["items"]}
    ids_pagina_2 = {item["id"] for item in cuerpo_2["items"]}
    assert ids_pagina_1.isdisjoint(ids_pagina_2)


@pytest.mark.parametrize("ruta", _RUTAS_PAGINADAS)
@pytest.mark.parametrize("limit_invalido", [0, 201])
def test_limit_fuera_de_rango_es_rechazado(client, ruta, limit_invalido):
    resp = client.get(f"{ruta}?limit={limit_invalido}")
    assert resp.status_code == 422
