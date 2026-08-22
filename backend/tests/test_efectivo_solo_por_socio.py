"""Administrators may register cash payments from the Members flow.

Cash registration remains restricted to the payment owner, their representative,
or an administrator; unrelated users remain forbidden.
"""
from app.dominio.cedula import cedula_valida
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_pagos import (
    crear_membresia_api,
    crear_persona_api,
    crear_tipo_membresia_api,
    registrar_pago_api,
)


def _autenticar_como(persona_id, roles):
    """Sobrescribe el token del cliente de test (mismo truco que
    `_autenticar_como` en test_ownership_pagos.py)."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def test_admin_puede_registrar_pago_efectivo_de_otra_persona(client):
    """Token del conftest: ADMINISTRADOR persona_id=1, distinto del dueño."""
    crear_persona_api(client, cedula=cedula_valida(240))  # relleno -> id=1 (el admin)
    persona = crear_persona_api(client, cedula="1710034073")  # id=2
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    resp = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO"
    )
    assert resp.status_code == 201, resp.text


def test_usuario_sin_vinculo_no_puede_registrar_pago_efectivo_ajeno(client):
    """La excepción para administradores no autoriza a terceros sin vínculo."""
    tercero = crear_persona_api(client, cedula=cedula_valida(240))
    persona = crear_persona_api(client, cedula="1710034073")
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    _autenticar_como(tercero["id"], ["ALUMNO"])
    resp = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO"
    )
    assert resp.status_code == 403, resp.text


def test_duenio_si_puede_registrar_su_propio_pago_efectivo(client):
    """El propio socio declarando su pago en efectivo sigue permitido."""
    persona = crear_persona_api(client, cedula="1710034073")
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO"
    )
    assert resp.status_code == 201, resp.text


def test_representante_si_registra_pago_efectivo_de_su_representado(client):
    """E04-RF003: el representante paga -- y declara -- por su representado."""
    representante = crear_persona_api(client, cedula=cedula_valida(241))  # id=1
    hijo = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado",
            "cedula": cedula_valida(242), "fecha_nacimiento": "2015-05-14",
            "telefono": "0991234567",
            "representante_id": representante["id"],
        },
    ).json()  # id=2
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, hijo["id"], tipo["id"])

    _autenticar_como(representante["id"], ["REPRESENTANTE"])
    resp = registrar_pago_api(
        client, hijo["id"], membresia["id"], tipo_pago="EFECTIVO"
    )
    assert resp.status_code == 201, resp.text
