from unittest.mock import patch

import pytest
from pydantic import ValidationError

import app.infraestructura.cloudinary_cliente as cc
from app.dominio.modelos import Sponsor
from app.presentacion.schemas.sponsor_schemas import SponsorCreateDTO
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.sponsor_servicio import SponsorServicio
from app.soporte_transversal.resiliencia import CIRCUITO_CLOUDINARY_UMBRAL_FALLOS

RUTA = "/api/v1/sponsors/"

# Firma binaria real de un JPEG (`\xff\xd8\xff`): el `content_type` que
# declara el cliente no prueba nada sobre el contenido, así que los tests que
# esperan una subida exitosa deben mandar bytes que coincidan con el tipo
# declarado (issue #838, punto 2).
JPEG_VALIDO = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100


def _registrar_subidas(monkeypatch) -> list[str]:
    """Reemplaza la subida a Cloudinary por un doble que registra cada
    llamada. Permite afirmar que un rechazo ocurrió ANTES de gastar la
    llamada externa, no después."""
    subidas: list[str] = []

    def _subir(contenido, public_id, content_type):
        subidas.append(public_id)
        return f"https://cdn/{public_id}.jpg"

    monkeypatch.setattr(
        "app.servicios_negocio.sponsor_servicio.subir_logo_sponsor", _subir,
    )
    return subidas


def test_listado_de_sponsors_es_publico(client_sin_permisos, db_session):
    db_session.add(Sponsor(nombre="Municipio", logo_url="https://cdn/logo.png", logo_public_id="logo-1"))
    db_session.commit()

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    cuerpo = response.json()
    assert len(cuerpo) == 1
    assert cuerpo[0]["nombre"] == "Municipio"
    assert cuerpo[0]["logoUrl"] == "https://cdn/logo.png"


def test_admin_sube_logo_jpg(client, monkeypatch):
    monkeypatch.setattr(
        "app.servicios_negocio.sponsor_servicio.subir_logo_sponsor",
        lambda contenido, public_id, content_type: f"https://cdn/{public_id}.jpg",
    )

    response = client.post(RUTA, data={"nombre": "  Municipio  "}, files={"archivo": ("logo.jpg", JPEG_VALIDO, "image/jpeg")})

    assert response.status_code == 201
    assert response.json()["nombre"] == "Municipio"
    assert response.json()["logoUrl"].startswith("https://cdn/")


@pytest.mark.parametrize("nombre", ["", "   \t\n"])
def test_no_puede_crear_sponsor_con_nombre_vacio_o_solo_espacios(nombre):
    with pytest.raises(ValidationError):
        SponsorCreateDTO(nombre=nombre)


def test_crear_sponsor_con_nombre_de_solo_espacios_devuelve_422(client):
    # Reproduce el bug real: un `nombre` no vacío para Starlette (llega al
    # form field) pero que el `field_validator` de `SponsorCreateDTO`
    # rechaza. Antes del fix, el `ValueError` del validador escapaba como
    # `pydantic_core.ValidationError` sin capturar y devolvía 500.
    response = client.post(RUTA, data={"nombre": "   \t\n"}, files={"archivo": ("logo.png", b"png", "image/png")})

    assert response.status_code == 422
    cuerpo = response.json()
    assert cuerpo["detail"] == "El nombre es obligatorio."
    assert cuerpo["message"] == "El nombre es obligatorio."


def test_crear_sponsor_con_nombre_vacio_devuelve_422(client):
    # Un valor de campo multipart genuinamente vacío nunca llega al
    # `field_validator`: Starlette lo trata como campo ausente y devuelve
    # 422 "Field required" antes de invocar el handler (confirmado también
    # sobre el código sin el fix -- no es el mismo bug, pero se deja
    # cubierto que jamás fue ni es un 500). `data={"nombre": ""}` con httpx
    # tampoco serializa el campo, así que se arma el multipart a mano para
    # forzar un valor vacío real.
    boundary = "regressionboundary"
    cuerpo_multipart = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="nombre"\r\n\r\n'
        "\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="archivo"; filename="logo.png"\r\n'
        "Content-Type: image/png\r\n\r\n"
        "png\r\n"
        f"--{boundary}--\r\n"
    ).encode()

    response = client.post(
        RUTA, content=cuerpo_multipart,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] != "Internal Server Error"


def test_admin_no_puede_subir_otro_tipo_de_archivo(client):
    response = client.post(RUTA, data={"nombre": "Municipio"}, files={"archivo": ("logo.gif", b"gif", "image/gif")})
    assert response.status_code == 400


def test_admin_elimina_logo_y_registro(client, db_session, monkeypatch):
    sponsor = Sponsor(nombre="Municipio", logo_url="https://cdn/logo.png", logo_public_id="logo-1")
    db_session.add(sponsor)
    db_session.commit()
    borrados = []
    monkeypatch.setattr("app.servicios_negocio.sponsor_servicio.eliminar_logo_sponsor", borrados.append)

    response = client.delete(f"{RUTA}{sponsor.id}")

    assert response.status_code == 204
    assert borrados == ["logo-1"]
    assert db_session.get(Sponsor, sponsor.id) is None


def test_eliminar_sponsor_con_cloudinary_caido_da_503_y_no_borra_la_fila(client, db_session):
    """Contracara HTTP del circuito compartido (issue #838, punto 3): con el
    circuito ABIERTO, `eliminar_logo_sponsor` corta antes de llamar al SDK y
    `sponsor_servicio.eliminar` nunca llega a borrar la fila -- el logo
    seguiría vivo en Cloudinary y el patrocinador desaparecería de la landing
    sin forma de recuperarlo.

    Fija además que el contrato de status del endpoint NO cambió con el fix:
    el 503 es el que `main.py::_MAPA_EXCEPCIONES` ya asignaba a
    `ServicioNoDisponible`, no uno nuevo."""
    sponsor = Sponsor(nombre="Municipio", logo_url="https://cdn/logo.png", logo_public_id="logo-1")
    db_session.add(sponsor)
    db_session.commit()
    for _ in range(CIRCUITO_CLOUDINARY_UMBRAL_FALLOS):
        cc._circuito_cloudinary.registrar_fallo()

    with patch("app.infraestructura.cloudinary_cliente.cloudinary.uploader.destroy") as destroy:
        response = client.delete(f"{RUTA}{sponsor.id}")

    assert response.status_code == 503
    assert destroy.call_count == 0
    assert db_session.get(Sponsor, sponsor.id) is not None


# --- Lectura acotada del logo (issues #824 y #838, punto 1) -----------------
# El router leía el cuerpo completo con `await archivo.read()` y recién
# después comparaba el tamaño contra el tope, en el servicio: el proceso
# materializaba en RAM un archivo arbitrariamente grande ANTES de saber si
# era aceptable. Era el único endpoint de subida del backend sin
# `leer_con_limite`.

def test_subir_logo_un_byte_sobre_el_tope_da_400_antes_de_cloudinary(client, monkeypatch):
    """cap+1: se rechaza con 400 y sin gastar la llamada al proveedor.
    Análogo a `test_voucher_pago.py::test_subir_voucher_excede_tamano_maximo
    _da_400_antes_de_cloudinary`."""
    subidas = _registrar_subidas(monkeypatch)
    contenido = b"\xff\xd8\xff" + b"\x00" * (SponsorServicio.TAMANO_MAXIMO_LOGO_BYTES - 2)
    assert len(contenido) == SponsorServicio.TAMANO_MAXIMO_LOGO_BYTES + 1

    response = client.post(
        RUTA, data={"nombre": "Municipio"},
        files={"archivo": ("logo.jpg", contenido, "image/jpeg")},
    )

    assert response.status_code == 400
    assert "tamaño" in response.json()["detail"].lower()
    assert subidas == []


def test_subir_logo_exactamente_en_el_tope_se_acepta(client, monkeypatch):
    """cap: el corte es "excede", no "alcanza" -- un logo de exactamente
    `TAMANO_MAXIMO_LOGO_BYTES` sigue siendo válido."""
    subidas = _registrar_subidas(monkeypatch)
    contenido = b"\xff\xd8\xff" + b"\x00" * (SponsorServicio.TAMANO_MAXIMO_LOGO_BYTES - 3)
    assert len(contenido) == SponsorServicio.TAMANO_MAXIMO_LOGO_BYTES

    response = client.post(
        RUTA, data={"nombre": "Municipio"},
        files={"archivo": ("logo.jpg", contenido, "image/jpeg")},
    )

    assert response.status_code == 201, response.text
    assert len(subidas) == 1


def test_el_400_por_tope_excedido_es_identico_al_de_los_otros_endpoints(client, monkeypatch):
    """Criterio de aceptación de #824: el rechazo por tope debe producir la
    MISMA respuesta que los otros tres endpoints de subida, "para que el
    frontend no tenga que distinguir casos".

    Se compara contra `POST /auth/me/foto`, que rechaza en el ROUTER (vía
    `leer_con_limite`) antes de tocar la base o Cloudinary -- por eso no
    necesita sembrar usuario. Ambos endpoints comparten el mismo tope de
    5 MB, así que el mensaje debe salir byte a byte igual."""
    _registrar_subidas(monkeypatch)
    assert (
        SponsorServicio.TAMANO_MAXIMO_LOGO_BYTES
        == AuthServicio.TAMANO_MAXIMO_FOTO_PERFIL_BYTES
    )
    contenido = b"\xff\xd8\xff" + b"\x00" * SponsorServicio.TAMANO_MAXIMO_LOGO_BYTES

    respuesta_sponsor = client.post(
        RUTA, data={"nombre": "Municipio"},
        files={"archivo": ("logo.jpg", contenido, "image/jpeg")},
    )
    respuesta_foto = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )

    assert respuesta_sponsor.status_code == 400
    assert respuesta_foto.status_code == 400
    assert respuesta_sponsor.json() == respuesta_foto.json()


# --- Verificación de firma binaria (issue #838, punto 2) -------------------
# `sponsor_servicio.py` no importaba `firma_archivos`: el `content_type` que
# manda el cliente era la única barrera de tipo, a diferencia de los otros
# tres caminos de subida.

def test_subir_logo_con_firma_que_no_coincide_da_400_antes_de_cloudinary(client, monkeypatch):
    """El cliente declara `image/jpeg` pero el contenido real no tiene la
    firma binaria de un JPEG -- debe rechazarse ANTES de llamar a Cloudinary,
    con el mismo mensaje que los otros tres caminos de subida."""
    subidas = _registrar_subidas(monkeypatch)
    contenido = b"esto no es una imagen real" + b"\x00" * 50

    response = client.post(
        RUTA, data={"nombre": "Municipio"},
        files={"archivo": ("logo.jpg", contenido, "image/jpeg")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "El contenido del archivo no coincide con el formato declarado"
    )
    assert subidas == []


def test_subir_logo_png_declarado_con_bytes_jpeg_da_400(client, monkeypatch):
    """La contracara: los bytes son una imagen real y válida, pero de OTRO
    formato del catálogo permitido. La firma detectada manda sobre el tipo
    declarado, no al revés."""
    subidas = _registrar_subidas(monkeypatch)

    response = client.post(
        RUTA, data={"nombre": "Municipio"},
        files={"archivo": ("logo.png", JPEG_VALIDO, "image/png")},
    )

    assert response.status_code == 400
    assert "no coincide" in response.json()["detail"].lower()
    assert subidas == []


def test_subir_logo_vacio_da_400_sin_hablar_del_formato(client, monkeypatch):
    """Un archivo de 0 bytes no coincide con la firma de NINGÚN tipo, así que
    sin un mensaje propio caería en el de firma no coincidente -- impreciso,
    porque el problema no es el formato sino el contenido ausente (mismo
    criterio que el issue #462 en el voucher). El chequeo de contenido vacío
    ya existía y debe seguir corriendo primero."""
    subidas = _registrar_subidas(monkeypatch)

    response = client.post(
        RUTA, data={"nombre": "Municipio"},
        files={"archivo": ("logo.png", b"", "image/png")},
    )

    assert response.status_code == 400
    detalle = response.json()["detail"].lower()
    assert "obligatorio" in detalle
    assert "no coincide" not in detalle
    assert subidas == []
