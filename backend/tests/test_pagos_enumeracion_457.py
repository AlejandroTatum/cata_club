"""
Issue #457: enumeración de pagos/membresías vía código de respuesta.

`PagoServicio.adjuntar_voucher` y `PagoServicio.obtener_pago` validaban en
este orden: 1) el recurso existe (404 si no) -> 2) estado (400, revelando el
estado real) -> 3) autorización (403). Un usuario autenticado SIN vínculo
con el pago podía distinguir, por el código de respuesta, si un pago ajeno
existía y en qué estado estaba -- ANTES de que se chequeara si tenía algo
que ver con él (reproducido en vivo dos veces, ver
`/tmp/cata-club-payments-go/02-voucher/457-enumeracion.md`).

Mismo mecanismo, mismo archivo, encontrado también en:
  - `PagoServicio.obtener_pago` (`GET /pagos/{id}`): oráculo residual más
    chico -- ya no filtraba estado, pero seguía filtrando existencia.
  - `MembresiaServicio.obtener_membresia` (`GET /membresias/{id}`).
  - `PagoServicio.aplicar_beneficio_bonificado`
    (`POST /membresias/{id}/aplicar-beneficio`).

El fix reordena: autorización PRIMERO, existencia/estado DESPUÉS. Para
quien no tiene ningún vínculo con el recurso (ni dueño, ni representante, ni
-- donde aplica -- admin), "no existe" y "existe pero no es mío" deben ser
indistinguibles: mismo código, mismo mensaje. Sigue el mismo criterio que
`PagoServicio.registrar_pago` ya aplicaba (ver su docstring, "Autorización
primero, existencia después") y que `test_seguridad_acceso_recursos.py`
fija para el resto del sistema.
"""
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_pagos import (
    crear_membresia_api, crear_persona_api, crear_tipo_membresia_api,
    escenario_pago_pendiente_api,
)

ID_INEXISTENTE = 999999


def _autenticar_como(persona_id, roles):
    """Sobrescribe el token del cliente de test (mismo truco que
    `test_ownership_pagos.py`/`test_cobertura_bonificada.py`)."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _autenticar_como_admin():
    _autenticar_como(1, ["ADMINISTRADOR", "ENTRENADOR"])


# --- GET /membresias/pagos/{pago_id} -----------------------------------------

def test_obtener_pago_extrano_recibe_403_uniforme_exista_o_no(client):
    persona, _membresia, pago = escenario_pago_pendiente_api(client)  # id=1
    extrano = crear_persona_api(client, cedula="1710034073")  # id=2

    _autenticar_como(extrano["id"], ["ALUMNO"])
    resp_existente = client.get(f"/api/v1/membresias/pagos/{pago['id']}")
    resp_inexistente = client.get(f"/api/v1/membresias/pagos/{ID_INEXISTENTE}")

    assert resp_existente.status_code == 403, resp_existente.text
    assert resp_inexistente.status_code == 403, resp_inexistente.text
    assert resp_existente.json()["detail"] == resp_inexistente.json()["detail"]


def test_obtener_pago_dueño_sigue_accediendo(client):
    persona, _membresia, pago = escenario_pago_pendiente_api(client)

    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = client.get(f"/api/v1/membresias/pagos/{pago['id']}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == pago["id"]


def test_obtener_pago_representante_sigue_accediendo(client):
    representante = crear_persona_api(client, cedula="1710034065")  # id=1
    hijo = client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Hijo", "apellidos": "Representado", "cedula": "1710034073",
            "fecha_nacimiento": "2015-05-14", "telefono": "0991234567",
            "representante_id": representante["id"],
        },
    ).json()
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, hijo["id"], tipo["id"])
    from tests.fabricas_pagos import crear_pago_api
    pago = crear_pago_api(client, hijo["id"], membresia["id"])

    _autenticar_como(representante["id"], ["REPRESENTANTE"])
    resp = client.get(f"/api/v1/membresias/pagos/{pago['id']}")
    assert resp.status_code == 200, resp.text


def test_obtener_pago_admin_distingue_inexistente_de_ajeno(client):
    persona, _membresia, pago = escenario_pago_pendiente_api(client)

    _autenticar_como_admin()
    resp_existente = client.get(f"/api/v1/membresias/pagos/{pago['id']}")
    resp_inexistente = client.get(f"/api/v1/membresias/pagos/{ID_INEXISTENTE}")

    assert resp_existente.status_code == 200, resp_existente.text
    assert resp_inexistente.status_code == 404, resp_inexistente.text


# --- POST /membresias/pagos/{pago_id}/voucher --------------------------------

def test_subir_voucher_extrano_recibe_403_uniforme_exista_o_no_y_sin_importar_estado(client):
    """Las tres clases distinguibles de la reproducción en vivo (404
    inexistente / 403 ajeno-pendiente / 400 ajeno-no-pendiente-mensaje-de-
    estado) deben colapsar en una sola: 403 con el mismo mensaje."""
    persona_pendiente, _m1, pago_pendiente = escenario_pago_pendiente_api(client)  # id=1
    persona_aprobada = crear_persona_api(client, cedula="1710034073")  # id=2
    tipo2 = crear_tipo_membresia_api(client)
    membresia_aprobada = crear_membresia_api(client, persona_aprobada["id"], tipo2["id"])
    from tests.fabricas_pagos import crear_pago_api
    pago_aprobado = crear_pago_api(client, persona_aprobada["id"], membresia_aprobada["id"])
    client.patch(
        f"/api/v1/membresias/pagos/{pago_aprobado['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    extrano = crear_persona_api(client, cedula="1710034081")  # id=3

    _autenticar_como(extrano["id"], ["ALUMNO"])
    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100  # JPEG-ish

    resp_pendiente = client.post(
        f"/api/v1/membresias/pagos/{pago_pendiente['id']}/voucher",
        files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
    )
    resp_aprobado = client.post(
        f"/api/v1/membresias/pagos/{pago_aprobado['id']}/voucher",
        files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
    )
    resp_inexistente = client.post(
        f"/api/v1/membresias/pagos/{ID_INEXISTENTE}/voucher",
        files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
    )

    assert resp_pendiente.status_code == 403, resp_pendiente.text
    assert resp_aprobado.status_code == 403, resp_aprobado.text
    assert resp_inexistente.status_code == 403, resp_inexistente.text
    detalles = {
        resp_pendiente.json()["detail"],
        resp_aprobado.json()["detail"],
        resp_inexistente.json()["detail"],
    }
    assert len(detalles) == 1, detalles


# --- GET /membresias/{membresia_id} ------------------------------------------

def test_obtener_membresia_extrano_recibe_403_uniforme_exista_o_no(client):
    persona = crear_persona_api(client, cedula="1710034065")  # id=1
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    extrano = crear_persona_api(client, cedula="1710034073")  # id=2

    _autenticar_como(extrano["id"], ["ALUMNO"])
    resp_existente = client.get(f"/api/v1/membresias/{membresia['id']}")
    resp_inexistente = client.get(f"/api/v1/membresias/{ID_INEXISTENTE}")

    assert resp_existente.status_code == 403, resp_existente.text
    assert resp_inexistente.status_code == 403, resp_inexistente.text
    assert resp_existente.json()["detail"] == resp_inexistente.json()["detail"]


def test_obtener_membresia_admin_distingue_inexistente_de_ajena(client):
    persona = crear_persona_api(client, cedula="1710034065")
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    _autenticar_como_admin()
    resp_existente = client.get(f"/api/v1/membresias/{membresia['id']}")
    resp_inexistente = client.get(f"/api/v1/membresias/{ID_INEXISTENTE}")

    assert resp_existente.status_code == 200, resp_existente.text
    assert resp_inexistente.status_code == 404, resp_inexistente.text


# --- POST /membresias/{membresia_id}/aplicar-beneficio -----------------------

def test_aplicar_beneficio_extrano_recibe_403_uniforme_exista_o_no(client):
    persona = crear_persona_api(client, cedula="1710034065")  # id=1
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    extrano = crear_persona_api(client, cedula="1710034073")  # id=2

    _autenticar_como(extrano["id"], ["ALUMNO"])
    resp_existente = client.post(
        f"/api/v1/membresias/{membresia['id']}/aplicar-beneficio", json={"meses": 1},
    )
    resp_inexistente = client.post(
        f"/api/v1/membresias/{ID_INEXISTENTE}/aplicar-beneficio", json={"meses": 1},
    )

    assert resp_existente.status_code == 403, resp_existente.text
    assert resp_inexistente.status_code == 403, resp_inexistente.text
    assert resp_existente.json()["detail"] == resp_inexistente.json()["detail"]


def test_aplicar_beneficio_admin_tambien_recibe_403_uniforme(client):
    """A diferencia de `obtener_pago`/`obtener_membresia`, este endpoint no
    tiene bypass de ADMINISTRADOR (ver docstring del servicio): ni siquiera
    el admin distingue "no existe" de "existe pero no es mío" acá, porque
    nunca tuvo acceso de por sí."""
    crear_persona_api(client, cedula="1710034065")  # relleno -> id=1 (el admin)
    persona = crear_persona_api(client, cedula="1710034073")  # id=2
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])

    _autenticar_como_admin()  # persona_id=1, distinto del titular
    resp_existente = client.post(
        f"/api/v1/membresias/{membresia['id']}/aplicar-beneficio", json={"meses": 1},
    )
    resp_inexistente = client.post(
        f"/api/v1/membresias/{ID_INEXISTENTE}/aplicar-beneficio", json={"meses": 1},
    )

    assert resp_existente.status_code == 403, resp_existente.text
    assert resp_inexistente.status_code == 403, resp_inexistente.text
    assert resp_existente.json()["detail"] == resp_inexistente.json()["detail"]
