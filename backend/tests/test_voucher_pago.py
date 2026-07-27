"""
Tests del endpoint POST /membresias/pagos/{pago_id}/voucher.
Cubre:
  - subida válida (JPG) a un pago PENDIENTE_VALIDACION por su dueño -> 201
    y los 3 campos voucher_* quedan completos en la respuesta.
  - subida válida (PDF) -> 201.
  - rechaza si el pago no está PENDIENTE_VALIDACION -> 400.
  - rechaza tipo de archivo no permitido -> 400.
  - rechaza si el solicitante no es dueño ni admin -> 403.
"""
from unittest.mock import patch

from app.seguridad.gestor_auth import GestorAutenticacion


# --- helpers comunes -------------------------------------------------------
def _crear_persona(client, cedula="1710034065"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "1990-01-01", "telefono": "0991234567",
        },
    ).json()


def _crear_tipo_membresia(client):
    return client.post(
        "/api/v1/membresias/tipos",
        json={
            "categoria": "Adultos", "franja_horaria": "18:00-19:00",
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


def _crear_pago(client, persona_id, membresia_id):
    return client.post(
        "/api/v1/membresias/pagos",
        json={
            "monto": "35.00", "tipo_pago": "TRANSFERENCIA",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona_id, "membresia_id": membresia_id,
        },
    ).json()


def _autenticar_como_duenio(client, persona_id):
    """Sobrescribe el token del cliente de test para que `persona_id` coincida
    con el dueño real del pago (necesario para el check de autorización del
    voucher, que sí la valida a diferencia del resto de endpoints del conftest)."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "ana@cataclub.test", "persona_id": persona_id, "roles": ["ALUMNO"],
    }


# Aseguramos que la subida a Cloudinary (que no está disponible en el entorno
# de test) se mockee siempre: nos interesa probar la lógica de validación +
# persistencia, no la integración real con Cloudinary.
_FAKE_URL_JPG = "https://res.cloudinary.com/test/image/upload/voucher-fake.jpg"
_FAKE_URL_PDF = "https://res.cloudinary.com/test/raw/upload/voucher-fake.pdf"


@patch(
    "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
    return_value=_FAKE_URL_JPG,
)
def test_subir_voucher_jpg_a_pago_pendiente_devuelve_201(_mock_cloudinary, client):
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    _autenticar_como_duenio(client, persona["id"])

    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100  # JPEG-ish
    resp = client.post(
        f"/api/v1/membresias/pagos/{pago['id']}/voucher",
        files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["voucherUrl"] == _FAKE_URL_JPG
    assert body["voucherFormato"] == "image/jpeg"
    assert body["voucherFechaCarga"] is not None


@patch(
    "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
    return_value=_FAKE_URL_PDF,
)
def test_subir_voucher_pdf_a_pago_pendiente_devuelve_201(_mock_cloudinary, client):
    persona = _crear_persona(client, cedula="1710034073")
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    _autenticar_como_duenio(client, persona["id"])

    contenido = b"%PDF-1.4\n" + b"\x00" * 100  # PDF-ish
    resp = client.post(
        f"/api/v1/membresias/pagos/{pago['id']}/voucher",
        files={"archivo": ("voucher.pdf", contenido, "application/pdf")},
    )

    assert resp.status_code == 201, resp.text
    assert resp.json()["voucherFormato"] == "application/pdf"


def test_subir_voucher_a_pago_no_pendiente_da_400(client):
    """El pago se aprueba primero; al intentar adjuntar el voucher debe
    rechazarse porque ya NO está PENDIENTE_VALIDACION (el check de estado
    ocurre AFTER el check de existencia y ANTES que el de autorización MIME)."""
    persona = _crear_persona(client, cedula="1710034081")
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    # Token del conftest: admin (persona_id=1). Autorización: admin pasa.
    # Estado: PENDIENTE_VALIDACION -> APROBADO vía PATCH (mock Celery ya activo).
    client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )

    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
    resp = client.post(
        f"/api/v1/membresias/pagos/{pago['id']}/voucher",
        files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
    )
    assert resp.status_code == 400
    assert "pendiente" in resp.json()["detail"].lower()


def test_subir_voucher_tipo_no_permitido_da_400(client):
    """text/plain no está en TIPOS_MIME_PERMITIDOS -> 400 antes de tocar
    Cloudinary."""
    persona = _crear_persona(client, cedula="1710034099")
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    resp = client.post(
        f"/api/v1/membresias/pagos/{pago['id']}/voucher",
        files={"archivo": ("voucher.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400
    assert "formato" in resp.json()["detail"].lower()


@patch("app.infraestructura.cloudinary_cliente.subir_voucher_pago")
def test_subir_voucher_firma_no_coincide_con_content_type_da_400(_mock_cloudinary, client):
    """El cliente declara `image/jpeg` pero el contenido real no tiene la
    firma binaria de un JPEG -- debe rechazarse ANTES de llamar a Cloudinary
    (REQ-SEC-3, sdd/production-readiness)."""
    persona = _crear_persona(client, cedula="1710034115")
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    _autenticar_como_duenio(client, persona["id"])

    contenido = b"esto no es una imagen real" + b"\x00" * 50
    resp = client.post(
        f"/api/v1/membresias/pagos/{pago['id']}/voucher",
        files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
    )
    assert resp.status_code == 400
    assert "no coincide" in resp.json()["detail"].lower()
    _mock_cloudinary.assert_not_called()


@patch("app.infraestructura.cloudinary_cliente.subir_voucher_pago")
def test_subir_voucher_excede_tamano_maximo_da_400_antes_de_cloudinary(_mock_cloudinary, client):
    """La lectura acotada (`leer_con_limite`) debe rechazar un archivo de
    más de 5MB sin llegar a invocar Cloudinary."""
    persona = _crear_persona(client, cedula="1710034123")
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    _autenticar_como_duenio(client, persona["id"])

    contenido_grande = b"\xff\xd8\xff\xe0" + b"\x00" * (5 * 1024 * 1024 + 1)
    resp = client.post(
        f"/api/v1/membresias/pagos/{pago['id']}/voucher",
        files={"archivo": ("voucher.jpg", contenido_grande, "image/jpeg")},
    )
    assert resp.status_code == 400
    assert "tamaño" in resp.json()["detail"].lower()
    _mock_cloudinary.assert_not_called()


def test_subir_voucher_sin_ser_duenio_ni_admin_da_403(client_sin_permisos, client):
    """
    Esquema:
      - Con `client` (admin) creamos persona+membresía+pago PENDIENTE_VALIDACION.
        Al solicitarse AMBAS fixtures (client_sin_permisos y client) en el mismo
        test, el último en inicializarse (client) deja sus `dependency_overrides`
        activos, así que hay que restaurar manualmente el token del alumno antes
        de la subida.
      - Con `client_sin_permisos` (rol ALUMNO, persona_id=1, distinta del dueño)
        intentamos subir el voucher -> 403.

    Truco: `client_sin_permisos` simula persona_id=1. La persona del pago debe
    tener id != 1 para que el check de autorización no la considere "dueño".
    Como el primer persona creado en SQLite con autoincrement empieza en 1,
    creamos una persona "relleno" primero para que la persona asociada al pago
    tenga id=2 o mayor.
    """
    _crear_persona(client, cedula="0000000001")  # relleno -> id=1
    persona = _crear_persona(client, cedula="1710034107")  # id=2
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    # Restaurar el token del alumno (persona_id=1, rol ALUMNO); la sesión ya
    # queda inyectada por la fixture `client_sin_permisos` (comparte db_session).
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "alumno@cataclub.test", "persona_id": 1, "roles": ["ALUMNO"],
    }

    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
    resp = client_sin_permisos.post(
        f"/api/v1/membresias/pagos/{pago['id']}/voucher",
        files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
    )
    assert resp.status_code == 403
