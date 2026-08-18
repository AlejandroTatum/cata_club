"""Administración de tarifas del catálogo (issue #394, dentro de #400).

El problema que cierra: `/membresias/tipos` exponía solo GET y POST, y
`TipoMembresiaRepositorio` no tenía `actualizar`. Para cambiar el precio de un
plan había que crear un tipo nuevo y dejar el viejo vivo en el catálogo. Una
fuente de verdad que solo se puede escribir una vez no es una fuente de
verdad: es un valor de siembra.

El candado que importa más que el endpoint
------------------------------------------
#394 lo plantea explícitamente ("un cambio de precio no puede reescribir el
pasado") y #400 lo vuelve regla no negociable: **un cambio de tarifa afecta
pagos futuros y jamás pagos previos**. Hoy eso se cumple por una razón
frágil: `membresia.monto_aplicado` es una COPIA del precio, no una
referencia. Antes de abrir la escritura del catálogo hay que fijar esa
propiedad con tests, porque es exactamente lo que se rompería sin que nadie
lo note -- ningún error, ninguna excepción, solo plata vieja que cambia de
valor.

Los dos tests de "no toca el pasado" son, entonces, el motivo real de este
archivo; el resto es el CRUD alrededor.
"""
import pytest

from tests.fabricas_pagos import (
    crear_membresia_api,
    crear_pago_api,
    crear_persona_api,
    crear_tipo_membresia_api,
)

RUTA_TIPOS = "/api/v1/membresias/tipos"


def test_un_admin_cambia_el_precio_de_una_tarifa(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "42.50"})

    assert respuesta.status_code == 200
    assert respuesta.json()["precio"] == "42.50"

    listado = client.get(RUTA_TIPOS).json()
    assert [t["precio"] for t in listado if t["id"] == tipo["id"]] == ["42.50"]


def test_cambiar_la_tarifa_no_toca_las_membresias_existentes(client):
    """La regla no negociable de #400. `monto_aplicado` es una copia del
    precio al momento de asignar el plan, no una referencia viva: subir la
    cuota del catálogo no puede cambiar retroactivamente lo que una membresía
    ya vigente tiene pactado."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    monto_original = membresia["montoAplicado"]

    client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "99.00"})

    despues = client.get(f"/api/v1/membresias/{membresia['id']}").json()
    assert despues["montoAplicado"] == monto_original


def test_cambiar_la_tarifa_no_toca_los_pagos_historicos(client):
    """Mismo candado, un nivel más abajo: el pago ya registrado conserva su
    monto y su período de cobertura. El historial nunca se recalcula con el
    catálogo actual."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    pago = crear_pago_api(client, persona["id"], membresia["id"])

    client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "99.00"})

    despues = client.get(f"/api/v1/membresias/pagos/{pago['id']}").json()
    assert despues["monto"] == pago["monto"]
    assert despues["fechaInicio"] == pago["fechaInicio"]
    assert despues["fechaFin"] == pago["fechaFin"]


def test_el_patch_parcial_solo_cambia_lo_enviado(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "40.00"})

    cuerpo = respuesta.json()
    assert cuerpo["precio"] == "40.00"
    assert cuerpo["categoria"] == tipo["categoria"]
    assert cuerpo["modalidad"] == tipo["modalidad"]


def test_se_puede_renombrar_la_categoria_sin_tocar_el_precio(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"categoria": "Infantil"})

    assert respuesta.status_code == 200
    assert respuesta.json()["categoria"] == "Infantil"
    assert respuesta.json()["precio"] == tipo["precio"]


def test_un_precio_no_positivo_es_rechazado(client):
    """El mismo `gt=0` que ya protege al POST: una tarifa en cero o negativa
    no describe ningún plan comercial y rompería la cuenta de meses, que
    divide por este número."""
    tipo = crear_tipo_membresia_api(client)

    assert client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "0"}).status_code == 422
    assert client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={"precio": "-5"}).status_code == 422


def test_un_patch_vacio_no_rompe_ni_cambia_nada(client):
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={})

    assert respuesta.status_code == 200
    assert respuesta.json() == tipo


@pytest.mark.parametrize("campo", ["categoria", "precio", "modalidad"])
def test_un_null_explicito_es_rechazado_con_422(client, campo):
    """Hallazgo de review adversarial (issue #400): `categoria`, `precio` y
    `modalidad` son NOT NULL en la base, pero el DTO las declaraba
    `Optional[...] = Field(None, ...)` -- la misma forma que
    `DescuentoUpdateDTO`, donde SÍ es correcta porque ahí un null explícito es
    una señal válida ("cambiar de porcentual a monto fijo"). Acá no hay
    ninguna modalidad "nula" del campo: un null explícito es simplemente un
    dato inválido.

    `exclude_unset` en el servicio solo descarta claves OMITIDAS del JSON;
    una clave presente con valor `null` cuenta como "seteada" y llegaba
    intacta hasta `setattr(tipo, campo, None)`, violando el NOT NULL de la
    columna. Eso reventaba como `IntegrityError` en el commit y el handler
    global de `main.py` lo traducía a un 409 de conflicto -- un status que no
    describe el problema real (dato inválido) ni nombra el campo. Debe
    rechazarse en la capa de validación, antes de tocar la base, con un 422
    que sí nombra el campo."""
    tipo = crear_tipo_membresia_api(client)

    respuesta = client.patch(f"{RUTA_TIPOS}/{tipo['id']}", json={campo: None})

    assert respuesta.status_code == 422
    assert campo in respuesta.text

    listado = client.get(RUTA_TIPOS).json()
    actual = next(t for t in listado if t["id"] == tipo["id"])
    assert actual[campo] == tipo[campo]


def test_una_tarifa_inexistente_da_404(client):
    assert client.patch(f"{RUTA_TIPOS}/999999", json={"precio": "40.00"}).status_code == 404


# Los dos candados de autorización NO piden también la fixture `client`: los
# overrides de dependencias son GLOBALES a la app, así que pedir el cliente
# admin en el mismo test reinstala el token y el endpoint contestaría 200.
# No hace falta un tipo real: la dependencia de permisos corre ANTES del
# handler, así que un id cualquiera alcanza para fijar quién puede entrar.
def test_sin_rol_administrador_da_403(client_sin_permisos):
    """Cambiar un precio es escribir sobre la plata con la que cobra el club:
    mismo candado de rol que el POST que ya existía."""
    respuesta = client_sin_permisos.patch(f"{RUTA_TIPOS}/1", json={"precio": "40.00"})

    assert respuesta.status_code == 403


def test_sin_token_da_401(client_sin_token):
    respuesta = client_sin_token.patch(f"{RUTA_TIPOS}/1", json={"precio": "40.00"})

    assert respuesta.status_code == 401
