"""
Propiedad de la membresía en el registro de pagos (auditoría, crítico 1).

`PagoServicio.registrar_pago` autorizaba por `persona_id` (dueño, su
representante, o ADMINISTRADOR) pero nunca verificaba que `membresia_id`
perteneciera a ESA persona: cualquier usuario podía registrar un pago propio
contra la membresía de un tercero y, al aprobarse, activar la membresía
ajena (pago cruzado).

Criterio de respuesta: mismo convenio que `test_seguridad_acceso_recursos.py`
-- el recurso existente de un tercero responde 403 (PermisosInsuficientes),
mientras que el inexistente sigue respondiendo 404.
"""
from unittest.mock import patch

from app.seguridad.gestor_auth import GestorAutenticacion


# --- helpers comunes (mismo esquema que test_voucher_pago.py) ---------------
def _crear_persona(client, cedula="1710034065", representante_id=None):
    payload = {
        "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
        "fecha_nacimiento": "1990-01-01", "telefono": "0991234567",
    }
    if representante_id is not None:
        payload.update({
            "nombres": "Hijo", "apellidos": "Representado",
            "fecha_nacimiento": "2015-05-14",
            "representante_id": representante_id,
        })
    return client.post("/api/v1/personas/", json=payload).json()


def _crear_tipo_membresia(client):
    return client.post(
        "/api/v1/membresias/tipos",
        json={
            "categoria": "Adultos",
            "precio": "35.00", "modalidad": "MENSUAL",
        },
    ).json()


def _crear_membresia(client, persona_id, tipo_id):
    return client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona_id, "tipo_membresia_id": tipo_id,
        },
    ).json()


def _payload_pago(persona_id, membresia_id):
    return {
        "monto": "35.00", "tipo_pago": "TRANSFERENCIA",
        "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
        "persona_id": persona_id, "membresia_id": membresia_id,
    }


def _autenticar_como(persona_id, roles):
    """Sobrescribe el token del cliente de test (mismo truco que
    `_autenticar_como_duenio` en test_voucher_pago.py)."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _autenticar_como_admin():
    _autenticar_como(1, ["ADMINISTRADOR", "ENTRENADOR"])


# --- POST /membresias/pagos: la membresía debe ser de la persona del pago ---

def test_alumno_no_puede_registrar_pago_contra_membresia_ajena(client):
    """El atacante autentica como él mismo (autorización por persona_id pasa)
    pero apunta `membresia_id` a la membresía de otra persona: 403, y la
    membresía ajena permanece INACTIVA."""
    victima = _crear_persona(client, cedula="1710034065")  # id=1
    tipo = _crear_tipo_membresia(client)
    membresia_victima = _crear_membresia(client, victima["id"], tipo["id"])
    atacante = _crear_persona(client, cedula="1710034073")  # id=2

    _autenticar_como(atacante["id"], ["ALUMNO"])
    resp = client.post(
        "/api/v1/membresias/pagos",
        json=_payload_pago(atacante["id"], membresia_victima["id"]),
    )
    assert resp.status_code == 403, resp.text

    # La membresía ajena no debe haber quedado en camino de activarse:
    # ni pago pendiente asociado, ni cambio de estado.
    _autenticar_como_admin()
    estado = client.get(
        f"/api/v1/membresias/{membresia_victima['id']}"
    ).json()["estado"]
    assert estado == "INACTIVA"
    historial = client.get(
        f"/api/v1/membresias/pagos/persona/{victima['id']}"
    ).json()
    assert historial == []


def test_admin_no_puede_registrar_pago_cruzado_persona_membresia(client):
    """El pago cruzado es inconsistente para cualquier rol: también un
    ADMINISTRADOR debe recibir 403 si la membresía no es de la persona
    del pago."""
    persona_a = _crear_persona(client, cedula="1710034065")  # id=1
    persona_b = _crear_persona(client, cedula="1710034073")  # id=2
    tipo = _crear_tipo_membresia(client)
    membresia_b = _crear_membresia(client, persona_b["id"], tipo["id"])

    # Token del conftest: ADMINISTRADOR (persona_id=1).
    resp = client.post(
        "/api/v1/membresias/pagos",
        json=_payload_pago(persona_a["id"], membresia_b["id"]),
    )
    assert resp.status_code == 403, resp.text


def test_membresia_inexistente_sigue_dando_404(client):
    """El chequeo de propiedad no cambia el contrato existente: una
    membresía que no existe sigue respondiendo 404, no 403."""
    persona = _crear_persona(client, cedula="1710034065")  # id=1
    resp = client.post(
        "/api/v1/membresias/pagos",
        json=_payload_pago(persona["id"], 999999),
    )
    assert resp.status_code == 404, resp.text


def test_representante_si_registra_pago_de_su_representado(client):
    """E04-RF003: el representante paga por su representado. El pago va a
    nombre del representado (persona_id del hijo) contra la membresía del
    hijo -- eso debe seguir permitido."""
    representante = _crear_persona(client, cedula="1733344455")  # id=1
    hijo = _crear_persona(
        client, cedula="1744455566", representante_id=representante["id"]
    )  # id=2
    tipo = _crear_tipo_membresia(client)
    membresia_hijo = _crear_membresia(client, hijo["id"], tipo["id"])

    _autenticar_como(representante["id"], ["REPRESENTANTE"])
    resp = client.post(
        "/api/v1/membresias/pagos",
        json=_payload_pago(hijo["id"], membresia_hijo["id"]),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["personaId"] == hijo["id"]


def test_admin_sigue_registrando_y_aprobando_pago_valido_de_cualquier_persona(client):
    """El flujo administrativo de hoy no cambia: registrar el pago válido de
    un tercero (membresía de ESA persona) y aprobarlo activa la membresía."""
    _crear_persona(client, cedula="0000000001")  # relleno -> id=1 (el admin)
    persona = _crear_persona(client, cedula="1710034073")  # id=2
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])

    # Token del conftest: ADMINISTRADOR persona_id=1, distinto del dueño.
    resp = client.post(
        "/api/v1/membresias/pagos",
        json=_payload_pago(persona["id"], membresia["id"]),
    )
    assert resp.status_code == 201, resp.text
    pago = resp.json()
    assert pago["estadoPago"] == "PENDIENTE_VALIDACION"

    aprobado = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert aprobado.status_code == 200
    estado = client.get(f"/api/v1/membresias/{membresia['id']}").json()["estado"]
    assert estado == "ACTIVA"


# --- POST /pagos/{id}/voucher: el vínculo de representación sigue vigente ---
# El caso del extraño (ni dueño ni representante ni admin) -> 403 ya está
# fijado en test_voucher_pago.py; acá se fija la contraparte positiva.

_FAKE_URL_JPG = "https://res.cloudinary.com/test/image/upload/voucher-fake.jpg"


@patch(
    "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
    return_value=_FAKE_URL_JPG,
)
def test_representante_si_sube_voucher_del_pago_de_su_representado(_mock_cloudinary, client):
    representante = _crear_persona(client, cedula="1733344455")  # id=1
    hijo = _crear_persona(
        client, cedula="1744455566", representante_id=representante["id"]
    )  # id=2
    tipo = _crear_tipo_membresia(client)
    membresia_hijo = _crear_membresia(client, hijo["id"], tipo["id"])
    pago = client.post(
        "/api/v1/membresias/pagos",
        json=_payload_pago(hijo["id"], membresia_hijo["id"]),
    ).json()

    _autenticar_como(representante["id"], ["REPRESENTANTE"])
    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100  # JPEG-ish
    resp = client.post(
        f"/api/v1/membresias/pagos/{pago['id']}/voucher",
        files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
    )
    assert resp.status_code == 201, resp.text
    # Mismo candado que test_voucher_pago.py: la URL de entrega se firma
    # fresca, no es la `secure_url` cruda que devolvió (acá, simuló) el SDK.
    assert resp.json()["voucherUrl"] != _FAKE_URL_JPG
    assert "/authenticated/" in resp.json()["voucherUrl"]
