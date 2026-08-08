"""
Solo el socio dueño del pago, o su representante, pueden registrar un pago
EFECTIVO -- un ADMINISTRADOR ya no puede hacerlo en nombre de un tercero.

Motivación (observación del dueño del club, vía su docente): un pago en
efectivo es una declaración de quien entregó el dinero ("el que paga
declara, el club valida"), así que solo puede declararla esa misma persona,
o quien paga en su representación. Antes de este cambio el ADMINISTRADOR
podía registrar un EFECTIVO por cualquiera desde `/members`, exactamente
igual que una TRANSFERENCIA -- lo que le permitía declarar una entrega de
dinero que no presenció.

La vía de TRANSFERENCIA para un tercero no cambia (ver
`test_ownership_pagos.py::test_admin_sigue_registrando_y_aprobando_pago_valido_de_cualquier_persona`):
esta guarda es específica de EFECTIVO.
"""
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


def test_admin_no_puede_registrar_pago_efectivo_de_otra_persona(client):
    """Token del conftest: ADMINISTRADOR persona_id=1, distinto del dueño."""
    crear_persona_api(client, cedula="0000000001")  # relleno -> id=1 (el admin)
    persona = crear_persona_api(client, cedula="1710034073")  # id=2
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    resp = registrar_pago_api(
        client, persona["id"], membresia["id"], tipo_pago="EFECTIVO"
    )
    assert resp.status_code == 403, resp.text

    # El mensaje que llega al humano no puede nombrar la implementación.
    detalle = resp.json()["detail"]
    assert "EFECTIVO" not in detalle
    assert "tipo_pago" not in detalle


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
    representante = crear_persona_api(client, cedula="1733344455")  # id=1
    hijo = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado",
            "cedula": "1744455566", "fecha_nacimiento": "2015-05-14",
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
