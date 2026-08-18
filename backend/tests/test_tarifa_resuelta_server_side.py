"""El backend resuelve la tarifa; el cliente no la envía (issue #400).

El agujero que cierra: `MembresiaCreateDTO` aceptaba `monto_aplicado` del
cliente y el servicio lo copiaba tal cual a la membresía, sin mirar
`TipoMembresia.precio`. El formulario administrativo sí consultaba el
catálogo, pero copiaba el precio en el navegador y lo mandaba de vuelta como
si fuera autoridad. Entre esos dos hechos, el número con el que el club cobra
viajaba por la red editable.

Regla no negociable de #400: *el frontend nunca envía autoritativamente un
precio mensual; el backend resuelve la tarifa vigente de `TipoMembresia`*.

El candado central es `test_un_monto_enviado_por_el_cliente_se_ignora`. No
alcanza con que el backend sepa resolver el precio: hay que demostrar que un
payload manipulado NO puede torcerlo, porque ese es el ataque real -- un
`POST` a mano pidiendo una membresía de un dólar.
"""
from app.dominio.cedula import cedula_valida
from tests.fabricas_pagos import crear_persona_api, crear_tipo_membresia_api

RUTA_MEMBRESIAS = "/api/v1/membresias/"
RUTA_TIPOS = "/api/v1/membresias/tipos"


def _crear_membresia(client, persona_id: int, tipo_id: int, **extra):
    """POST crudo (no la fábrica) para poder mandar campos de más y
    demostrar qué hace el backend con ellos."""
    return client.post(
        RUTA_MEMBRESIAS,
        json={"persona_id": persona_id, "tipo_membresia_id": tipo_id, **extra},
    )


def test_el_backend_resuelve_el_precio_del_catalogo(client):
    """El payload mínimo ya no lleva plata: solo a quién y qué plan."""
    persona = crear_persona_api(client, cedula_valida(901))
    tipo = crear_tipo_membresia_api(client)

    respuesta = _crear_membresia(client, persona["id"], tipo["id"])

    assert respuesta.status_code == 201
    assert respuesta.json()["montoAplicado"] == tipo["precio"]


def test_un_monto_enviado_por_el_cliente_se_ignora(client):
    """EL candado. Un payload manipulado que pide una membresía de un dólar
    sobre un plan de $35 recibe $35: el precio no es negociable desde el
    cliente."""
    persona = crear_persona_api(client, cedula_valida(902))
    tipo = crear_tipo_membresia_api(client)

    respuesta = _crear_membresia(
        client, persona["id"], tipo["id"], monto_aplicado="1.00",
    )

    assert respuesta.status_code == 201
    assert respuesta.json()["montoAplicado"] == tipo["precio"]
    assert respuesta.json()["montoAplicado"] != "1.00"


def test_un_cambio_de_tarifa_alcanza_a_las_membresias_nuevas_y_no_a_las_viejas(client):
    """Las dos mitades de la regla de #400 en un solo escenario, que es la
    única forma de ver que no se contradicen: la membresía creada ANTES
    conserva su monto, la creada DESPUÉS toma el nuevo."""
    tipo = crear_tipo_membresia_api(client)
    precio_original = tipo["precio"]

    persona_vieja = crear_persona_api(client, cedula_valida(903))
    vieja = _crear_membresia(client, persona_vieja["id"], tipo["id"]).json()

    client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "50.00"})

    persona_nueva = crear_persona_api(client, cedula_valida(904))
    nueva = _crear_membresia(client, persona_nueva["id"], tipo["id"]).json()

    assert nueva["montoAplicado"] == "50.00"
    assert (
        client.get(f"/api/v1/membresias/{vieja['id']}").json()["montoAplicado"]
        == precio_original
    )


def test_un_tipo_de_membresia_inexistente_da_404(client):
    persona = crear_persona_api(client, cedula_valida(905))

    assert _crear_membresia(client, persona["id"], 999999).status_code == 404


def test_una_persona_inexistente_da_404(client):
    tipo = crear_tipo_membresia_api(client)

    assert _crear_membresia(client, 999999, tipo["id"]).status_code == 404
