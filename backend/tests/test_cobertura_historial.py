"""Historial de coberturas bonificadas por persona (issue #1369, slice 3).

El historial de pagos de un alumno (`GET /membresias/pagos/persona/{id}`)
nunca mostró una activación de cobertura bonificada: el #400/4d no creó
ningún `Pago` (a propósito), así que el mes cubierto por el beneficio era
invisible para quien revisa su historial financiero. Este slice expone
`GET /membresias/coberturas/persona/{persona_id}` para que el frontend pueda
mezclar esas activaciones como filas del MISMO historial.

Reglas bajo prueba:
- El dueño ve sus coberturas (autoservicio, igual que su historial de pagos).
- La misma autorización que `listar_pagos_de_persona`
  (`PoliticaAccesoPersona`): propia persona, su representante, o
  ADMINISTRADOR -- un extraño recibe 403.
"""
from decimal import Decimal

from app.dominio.cedula import cedula_valida
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_pagos import (
    asignar_beneficio_api, crear_membresia_api, crear_persona_api,
    crear_tipo_membresia_api,
)

RUTA_COBERTURAS = "/api/v1/membresias/coberturas/persona/{persona_id}"
RUTA_APLICAR = "/api/v1/membresias/{membresia_id}/aplicar-beneficio"


def _autenticar_como(persona_id, roles):
    """Sobrescribe el token del cliente de test (mismo truco que
    `test_cobertura_bonificada.py`)."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _escenario_con_cobertura(client, persona: dict) -> dict:
    """Membresía de `persona` + beneficio 100% + UNA activación hecha por el
    propio titular. Devuelve la membresía creada."""
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    descuento = client.post(
        "/api/v1/descuentos/",
        json={"nombre": "Becado", "activo": True, "porcentaje": "100.00"},
    ).json()
    asignar_beneficio_api(client, persona["id"], descuento["id"])

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = client.post(RUTA_APLICAR.format(membresia_id=membresia["id"]), json={})
    assert resp.status_code == 201, resp.text
    return membresia


def test_el_dueno_ve_sus_coberturas_con_su_periodo(client):
    """Casamiento con el historial de pagos: misma ruta de autorización, una
    fila por activación, con el período que cubre."""
    persona = crear_persona_api(client, cedula=cedula_valida(901))
    membresia = _escenario_con_cobertura(client, persona)

    resp = client.get(RUTA_COBERTURAS.format(persona_id=persona["id"]))
    assert resp.status_code == 200, resp.text
    coberturas = resp.json()
    assert len(coberturas) == 1
    cuerpo = coberturas[0]
    assert cuerpo["personaId"] == persona["id"]
    assert cuerpo["membresiaId"] == membresia["id"]
    assert cuerpo["mesesComprados"] == 1
    assert cuerpo["fechaInicio"] and cuerpo["fechaFin"]
    assert Decimal(cuerpo["tarifaMensualAplicada"]) == Decimal("35.00")


def test_extrano_no_ve_las_coberturas_de_otro(client):
    """Mismo guardarraíl que `listar_pagos_de_persona`: un ALUMNO sin
    relación con la persona recibe 403, no la lista."""
    persona_uno = crear_persona_api(client, cedula=cedula_valida(901))
    _escenario_con_cobertura(client, persona_uno)
    # `crear_persona` exige ADMIN: el escenario dejó el token del titular.
    _autenticar_como(1, ["ADMINISTRADOR", "ENTRENADOR"])
    persona_ajena = crear_persona_api(client, cedula=cedula_valida(902))

    _autenticar_como(persona_ajena["id"], ["ALUMNO"])
    resp = client.get(RUTA_COBERTURAS.format(persona_id=persona_uno["id"]))
    assert resp.status_code == 403, resp.text


def test_admin_puede_ver_las_coberturas_de_cualquiera(client):
    """Tercer caso de `PoliticaAccesoPersona`: un administrador sí puede
    revisar el historial de cualquier persona."""
    persona = crear_persona_api(client, cedula=cedula_valida(901))
    _escenario_con_cobertura(client, persona)

    _autenticar_como(persona["id"] + 100, ["ADMINISTRADOR", "ENTRENADOR"])
    resp = client.get(RUTA_COBERTURAS.format(persona_id=persona["id"]))
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 1
