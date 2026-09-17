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
from urllib.parse import parse_qs, urlparse

import pytest

from app.dominio.cedula import cedula_valida
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


def _crear_pago(client, persona_id, membresia_id):
    return client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "TRANSFERENCIA",
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
def test_subir_voucher_jpg_a_pago_pendiente_devuelve_201(_mock_cloudinary, client, db_session):
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
    # Candado del hallazgo de privacidad "voucher no enumerable": la URL que
    # ve el cliente NO es la `secure_url` que devolvió el SDK al subir (esa
    # URL corresponde a un recurso `type="authenticated"`, no sirve sin
    # firmar) -- es una URL de entrega firmada, generada recién al responder.
    #
    # Issue #1072: y sale por el endpoint de descarga de la API, no por la
    # CDN, porque es el único camino cuyo vencimiento lo chequea Cloudinary
    # del lado del servidor. `authenticated` viaja como parámetro y la
    # extensión (que el recurso `raw` lleva DENTRO del `public_id`) también.
    assert body["voucherUrl"] != _FAKE_URL_JPG
    assert "res.cloudinary.com" not in body["voucherUrl"]
    parametros = parse_qs(urlparse(body["voucherUrl"]).query)
    assert parametros["type"] == ["authenticated"]
    assert parametros["expires_at"]
    # El `public_id` del endpoint lleva la CARPETA y la extensión (el nombre
    # real del recurso `raw`), no solo el id pelado.
    from app.soporte_transversal.configuracion import settings
    assert parametros["public_id"][0].startswith(
        f"{settings.cloudinary_carpeta_vouchers}/voucher-pago-{pago['id']:08d}-v1-"
    )
    assert parametros["public_id"][0].endswith(".jpg")
    assert body["voucherFormato"] == "image/jpeg"
    assert body["voucherFechaCarga"] is not None

    # Verificación directa en Postgres (no solo la respuesta HTTP): la
    # columna `voucher_url` guarda el `public_id` -- con la extensión, porque
    # es el nombre real del recurso `raw` (issue #1072) -- NUNCA la
    # `secure_url` pública que devolvió (acá, simuló) el SDK.
    from app.dominio.modelos import Pago
    fila = db_session.get(Pago, pago["id"])
    assert fila.voucher_url.startswith(f"voucher-pago-{pago['id']:08d}-v1-")
    assert fila.voucher_url.endswith(".jpg")
    assert fila.voucher_url != _FAKE_URL_JPG
    assert not fila.voucher_url.startswith("http")


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
    body = resp.json()
    assert body["voucherFormato"] == "application/pdf"
    assert body["voucherUrl"] != _FAKE_URL_PDF
    # Mismo candado que el voucher en JPEG (arriba), sobre la forma que
    # corresponde al PDF: un PDF NO se entrega por la CDN -- esta cuenta la
    # deniega con un 401 -- sino por el endpoint de descarga de la API, donde
    # `authenticated` viaja como parámetro y no como segmento de la ruta (ver
    # `_url_descarga_api` en `cloudinary_cliente.py`).
    parametros = parse_qs(urlparse(body["voucherUrl"]).query)
    assert "res.cloudinary.com" not in body["voucherUrl"]
    assert parametros["type"] == ["authenticated"]
    assert parametros["public_id"][0].endswith(".pdf")
    assert "voucher-pago-" in parametros["public_id"][0]


def test_voucher_imagen_previo_al_fix_se_sigue_entregando(client, db_session):
    """Transición del issue #1072 (el test que fija el orden de despliegue):
    una fila escrita ANTES del fix persiste un `public_id` SIN extensión bajo
    `image/authenticated`. Si la entrega pidiera `raw` a ciegas, esa fila
    pasaría a 404 en cuanto sube el código nuevo, o sea que desplegar antes de
    migrar rompería vouchers ya subidos. Se sigue sirviendo por la CDN firmada
    (como ayer) hasta que corra `scripts/migrar_imagenes_a_raw.py`, en
    cualquier orden."""
    from app.dominio.modelos import Pago

    persona = _crear_persona(client, cedula=cedula_valida(419))
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    fila = db_session.get(Pago, pago["id"])
    fila.voucher_url = f"voucher-pago-{pago['id']:08d}-v1-legacy"
    fila.voucher_formato = "image/jpeg"
    db_session.commit()

    _autenticar_como_duenio(client, persona["id"])
    resp = client.get(f"/api/v1/membresias/pagos/{pago['id']}")

    assert resp.status_code == 200, resp.text
    url = resp.json()["voucherUrl"]
    assert url is not None
    assert url.startswith("https://res.cloudinary.com/")
    assert "/image/authenticated/" in url
    assert "/raw/download" not in url


# --- Borrado del voucher reemplazado (issue #1072) -------------------------
# El reemplazo limpia el voucher anterior con `eliminar_voucher_pago`. Con un
# `resource_type` equivocado ese borrado no falla -- Cloudinary responde
# `not found` -- así que el comprobante bancario viejo queda vivo en el
# proveedor. Estos dos tests fijan la discriminación por forma persistida en
# el camino REAL (servicio -> SDK), no en el helper aislado.

def _parchear_destroy():
    return patch("app.infraestructura.cloudinary_cliente.cloudinary.uploader.destroy")


@patch(
    "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
    return_value=_FAKE_URL_JPG,
)
def test_reemplazo_borra_el_voucher_previo_con_el_resource_type_de_su_forma(
    _mock_subir, client, db_session
):
    from app.dominio.modelos import Pago
    from app.soporte_transversal.configuracion import settings

    persona = _crear_persona(client, cedula=cedula_valida(420))
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    # El pago ya tenía un voucher de cada forma persistida.
    formas = [
        ("voucher-pago-previo-v1-legacy", "image/jpeg", "image"),
        ("voucher-pago-previo-v1-legacy.jpg", "image/jpeg", "raw"),
        ("voucher-pago-previo-v1-legacy-pdf", "application/pdf", "raw"),
    ]

    for public_id_previo, formato_previo, resource_type_esperado in formas:
        fila = db_session.get(Pago, pago["id"])
        fila.voucher_url = public_id_previo
        fila.voucher_formato = formato_previo
        db_session.commit()

        _autenticar_como_duenio(client, persona["id"])
        contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
        with _parchear_destroy() as mock_destroy:
            resp = client.post(
                f"/api/v1/membresias/pagos/{pago['id']}/voucher",
                files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
            )

        assert resp.status_code == 201, resp.text
        borrados = {
            llamada.args[0]: llamada.kwargs
            for llamada in mock_destroy.call_args_list
        }
        clave = f"{settings.cloudinary_carpeta_vouchers}/{public_id_previo}"
        assert clave in borrados, (public_id_previo, list(borrados))
        assert borrados[clave]["resource_type"] == resource_type_esperado
        assert borrados[clave]["type"] == "authenticated"


@pytest.mark.parametrize(
    "formato_previo",
    [None, "", "octet-stream"],
    ids=["formato-null", "formato-vacio", "formato-atipico"],
)
@patch(
    "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
    return_value=_FAKE_URL_JPG,
)
def test_reemplazo_borra_el_voucher_previo_con_formato_null_o_atipico(
    _mock_subir, formato_previo, client, db_session
):
    """Issue #1072 (transición): una fila vieja puede tener `voucher_formato`
    NULL o atípico -- la columna es VARCHAR(20) y hay filas que nunca pasaron
    por el `content_type` validado. Ese hueco NO es información, pero el
    `public_id` SIN extensión SÍ lo es: el asset vive como
    `image/authenticated`. El guard anterior exigía un MIME de la allowlist y
    salteaba el borrado, así que el comprobante bancario viejo (dato del
    socio) quedaba vivo en el proveedor sin fallar y sin avisar. El
    `resource_type` sale de `resource_type_de_destruccion` (forma del
    `public_id` + conocimiento de PDF), nunca del guard.
    """
    from app.dominio.modelos import Pago
    from app.soporte_transversal.configuracion import settings

    persona = _crear_persona(client, cedula=cedula_valida(421))
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    public_id_previo = "voucher-pago-previo-v1-sin-formato"
    fila = db_session.get(Pago, pago["id"])
    fila.voucher_url = public_id_previo
    fila.voucher_formato = formato_previo
    db_session.commit()

    _autenticar_como_duenio(client, persona["id"])
    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
    with _parchear_destroy() as mock_destroy:
        resp = client.post(
            f"/api/v1/membresias/pagos/{pago['id']}/voucher",
            files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
        )

    assert resp.status_code == 201, resp.text
    clave = f"{settings.cloudinary_carpeta_vouchers}/{public_id_previo}"
    borrados = {
        llamada.args[0]: llamada.kwargs for llamada in mock_destroy.call_args_list
    }
    assert clave in borrados, list(borrados)
    assert borrados[clave]["resource_type"] == "image"
    assert borrados[clave]["type"] == "authenticated"


@patch(
    "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
    return_value=_FAKE_URL_JPG,
)
def test_reemplazo_no_destruye_un_voucher_legado_por_url_publica(
    _mock_subir, client, db_session
):
    """El otro borde del guard, que el hardening NO relaja: una `secure_url`
    completa (recurso `type="upload"` público, previo al issue #553) no es un
    `public_id` y no se puede destruir por nombre. Se sigue salteando tal
    cual, con formato NULL incluido -- lo único que cambió es el filtro por
    `voucher_formato`, no la regla sobre URLs heredadas.
    """
    from app.dominio.modelos import Pago

    persona = _crear_persona(client, cedula=cedula_valida(422))
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    fila = db_session.get(Pago, pago["id"])
    fila.voucher_url = "https://res.cloudinary.com/test/image/upload/voucher-legado.jpg"
    fila.voucher_formato = None
    db_session.commit()

    _autenticar_como_duenio(client, persona["id"])
    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
    with _parchear_destroy() as mock_destroy:
        resp = client.post(
            f"/api/v1/membresias/pagos/{pago['id']}/voucher",
            files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
        )

    assert resp.status_code == 201, resp.text
    assert mock_destroy.call_args_list == []


@patch(
    "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
    return_value=_FAKE_URL_JPG,
)
def test_reemplazo_sin_voucher_previo_no_destruye_nada(
    _mock_subir, client, db_session
):
    """Guard normal de 'no hay voucher anterior': primer voucher de un pago
    recién creado. El hardening no lo toca; sin `voucher_anterior` no hay
    nada que borrar ni que reportar.
    """
    persona = _crear_persona(client, cedula=cedula_valida(423))
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    _autenticar_como_duenio(client, persona["id"])
    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
    with _parchear_destroy() as mock_destroy:
        resp = client.post(
            f"/api/v1/membresias/pagos/{pago['id']}/voucher",
            files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
        )

    assert resp.status_code == 201, resp.text
    assert mock_destroy.call_args_list == []


def test_subir_voucher_tras_fallo_de_cloudinary_permite_reintentar(client, db_session):
    """El flujo que el fix no puede romper: si la subida a Cloudinary falla
    (503), el pago queda SIN voucher (la fila nunca llega a `pago.voucher_url
    = ...`) para que la fila de pagos del alumno lo muestre marcado, con
    botón para volver a intentar. Un segundo intento, ya sin el fallo, debe
    poder completarse con éxito."""
    from app.dominio.excepciones import ServicioNoDisponible
    from app.dominio.modelos import Pago

    persona = _crear_persona(client, cedula="1710034131")
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])
    _autenticar_como_duenio(client, persona["id"])
    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100

    with patch(
        "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
        side_effect=ServicioNoDisponible("Cloudinary caído"),
    ):
        resp_fallo = client.post(
            f"/api/v1/membresias/pagos/{pago['id']}/voucher",
            files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
        )
    assert resp_fallo.status_code == 503

    fila = db_session.get(Pago, pago["id"])
    assert fila.voucher_url is None

    with patch(
        "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
        return_value=_FAKE_URL_JPG,
    ):
        resp_reintento = client.post(
            f"/api/v1/membresias/pagos/{pago['id']}/voucher",
            files={"archivo": ("voucher.jpg", contenido, "image/jpeg")},
        )
    assert resp_reintento.status_code == 201, resp_reintento.text
    assert resp_reintento.json()["voucherUrl"] is not None


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
        # Issue #459: TRANSFERENCIA sin voucher adjunto (`_crear_pago`).
        json={
            "estado_pago": "APROBADO",
            "motivo_excepcion_sin_comprobante": "Verificado directamente en la cuenta del club.",
        },
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
def test_subir_voucher_archivo_vacio_da_400_con_mensaje_de_archivo_vacio(_mock_cloudinary, client):
    """Issue #462: un archivo de 0 bytes no tiene firma binaria que coincida
    con NINGÚN tipo MIME soportado, así que caía en el mensaje genérico de
    `es_firma_valida` ("no coincide con el formato declarado") -- impreciso,
    porque no habla de tipo de archivo sino de contenido ausente. Debe
    distinguirse con un mensaje propio, distinto del de firma no coincidente,
    y sin tocar Cloudinary."""
    persona = _crear_persona(client, cedula=cedula_valida(700))
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])

    _autenticar_como_duenio(client, persona["id"])

    resp = client.post(
        f"/api/v1/membresias/pagos/{pago['id']}/voucher",
        files={"archivo": ("voucher.jpg", b"", "image/jpeg")},
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"].lower()
    assert "vacío" in detail
    assert "no coincide" not in detail
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


@patch("app.infraestructura.cloudinary_cliente.subir_voucher_pago")
def test_subir_voucher_sin_ser_duenio_ni_admin_da_403(_mock_cloudinary, client_sin_permisos, client):
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
    _crear_persona(client, cedula=cedula_valida(640))  # relleno -> id=1
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
    # Issue #813: la autorización sigue corriendo ANTES de la subida. Al
    # sacar la red de la transacción, el orden de los pasos es lo único que
    # garantiza que un desconocido no pueda hacernos escribir en Cloudinary
    # -- un 403 devuelto DESPUÉS de subir el archivo seguiría siendo un 403.
    _mock_cloudinary.assert_not_called()
