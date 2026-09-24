from unittest.mock import patch

import pytest
from pydantic import ValidationError

import app.infraestructura.cloudinary_cliente as cc
from app.dominio.modelos import EntradaGaleria
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.dtos.galeria_schemas import EntradaGaleriaCreateDTO
from app.servicios_negocio.galeria_servicio import GaleriaServicio
from app.soporte_transversal.resiliencia import CIRCUITO_CLOUDINARY_UMBRAL_FALLOS

RUTA = "/api/v1/galeria/"

# Firma binaria real de un JPEG (`\xff\xd8\xff`): el `content_type` que
# declara el cliente no prueba nada sobre el contenido, así que los tests que
# esperan una subida exitosa deben mandar bytes que coincidan con el tipo
# declarado (mismo criterio que `test_sponsors.py`).
JPEG_VALIDO = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
PNG_VALIDO = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


def _registrar_subidas(monkeypatch) -> list[str]:
    """Reemplaza la subida a Cloudinary por un doble que registra cada
    llamada. Permite afirmar que un rechazo ocurrió ANTES de gastar la
    llamada externa, no después."""
    subidas: list[str] = []

    def _subir(contenido, public_id, content_type):
        subidas.append(public_id)
        return f"https://cdn/{public_id}.jpg"

    monkeypatch.setattr(
        "app.servicios_negocio.galeria_servicio.subir_imagen_galeria", _subir,
    )
    return subidas


# --- Lectura pública --------------------------------------------------------

def test_listado_de_galeria_es_publico(client_sin_permisos, db_session):
    db_session.add(EntradaGaleria(
        titulo="Torneo", descripcion="Cierre anual",
        imagen_url="https://cdn/torneo.png", imagen_public_id="entrada-1",
    ))
    db_session.commit()

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    cuerpo = response.json()
    assert len(cuerpo) == 1
    assert cuerpo[0]["titulo"] == "Torneo"
    assert cuerpo[0]["descripcion"] == "Cierre anual"
    assert cuerpo[0]["imagenUrl"] == "https://cdn/torneo.png"


def test_listado_de_galeria_vacia_devuelve_lista_vacia(client_sin_permisos):
    # Decisión del issue #1372: la galería arranca vacía; la landing renderiza
    # lo persistido, nada sembrado.
    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    assert response.json() == []


# --- Creación (admin, multipart) --------------------------------------------

def test_admin_sube_entrada_jpg(client, monkeypatch):
    monkeypatch.setattr(
        "app.servicios_negocio.galeria_servicio.subir_imagen_galeria",
        lambda contenido, public_id, content_type: f"https://cdn/{public_id}.jpg",
    )

    response = client.post(
        RUTA,
        data={"titulo": "  Torneo  ", "descripcion": "  Cierre anual  "},
        files={"archivo": ("foto.jpg", JPEG_VALIDO, "image/jpeg")},
    )

    assert response.status_code == 201
    cuerpo = response.json()
    assert cuerpo["titulo"] == "Torneo"
    assert cuerpo["descripcion"] == "Cierre anual"
    assert cuerpo["imagenUrl"].startswith("https://cdn/")


def test_admin_sube_entrada_png(client, db_session, monkeypatch):
    monkeypatch.setattr(
        "app.servicios_negocio.galeria_servicio.subir_imagen_galeria",
        lambda contenido, public_id, content_type: f"https://cdn/{public_id}.png",
    )

    response = client.post(
        RUTA,
        data={"titulo": "Escuela", "descripcion": "Clases sabatinas"},
        files={"archivo": ("foto.png", PNG_VALIDO, "image/png")},
    )

    assert response.status_code == 201
    sembrada = db_session.query(EntradaGaleria).one()
    assert sembrada.titulo == "Escuela"
    assert sembrada.imagen_url.startswith("https://cdn/")
    assert len(sembrada.imagen_public_id) == 36  # uuid4


@pytest.mark.parametrize(
    "titulo, descripcion",
    [("", "Cierre anual"), ("   \t\n", "Cierre anual"),
     ("Torneo", ""), ("Torneo", "   \t\n")],
)
def test_no_puede_crear_entrada_con_titulo_o_descripcion_vacios(titulo, descripcion):
    with pytest.raises(ValidationError):
        EntradaGaleriaCreateDTO(titulo=titulo, descripcion=descripcion)


def test_crear_entrada_con_campos_de_solo_espacios_devuelve_422(client):
    # Mismo bug que reprodujo `test_sponsors.py`: un valor no vacío para
    # Starlette (llega al form field) pero que el `field_validator` del DTO
    # rechaza. Antes de capturar el `ValidationError`, el `ValueError`
    # escapaba como `pydantic_core.ValidationError` sin capturar y devolvía
    # 500 en vez del 422 con el mensaje en castellano.
    response = client.post(
        RUTA,
        data={"titulo": "   \t\n", "descripcion": "Cierre anual"},
        files={"archivo": ("foto.png", PNG_VALIDO, "image/png")},
    )

    assert response.status_code == 422
    cuerpo = response.json()
    assert cuerpo["detail"] == "El título es obligatorio."
    assert cuerpo["message"] == "El título es obligatorio."


def test_admin_no_puede_subir_otro_tipo_de_archivo(client):
    response = client.post(
        RUTA,
        data={"titulo": "Torneo", "descripcion": "Cierre anual"},
        files={"archivo": ("foto.gif", b"gif", "image/gif")},
    )
    assert response.status_code == 400


# --- Eliminación (admin) -----------------------------------------------------

def test_admin_elimina_entrada_y_recurso(client, db_session, monkeypatch):
    entrada = EntradaGaleria(
        titulo="Torneo", descripcion="Cierre anual",
        imagen_url="https://cdn/torneo.png", imagen_public_id="entrada-1",
    )
    db_session.add(entrada)
    db_session.commit()
    borrados = []
    monkeypatch.setattr(
        "app.servicios_negocio.galeria_servicio.eliminar_imagen_galeria", borrados.append,
    )

    response = client.delete(f"{RUTA}{entrada.id}")

    assert response.status_code == 204
    assert borrados == ["entrada-1"]
    assert db_session.get(EntradaGaleria, entrada.id) is None


def test_eliminar_entrada_inexistente_devuelve_404(client):
    response = client.delete(f"{RUTA}99999")
    assert response.status_code == 404


def test_eliminar_entrada_con_cloudinary_caido_da_503_y_no_borra_la_fila(client, db_session):
    """Contracara HTTP del circuito compartido (mismo criterio que
    `test_sponsors.py`): con el circuito ABIERTO, `eliminar_imagen_galeria`
    corta antes de llamar al SDK y `GaleriaServicio.eliminar` nunca llega a
    borrar la fila -- la imagen seguiría viva en Cloudinary y la entrada
    desaparecería de la landing sin forma de recuperarla."""
    entrada = EntradaGaleria(
        titulo="Torneo", descripcion="Cierre anual",
        imagen_url="https://cdn/torneo.png", imagen_public_id="entrada-1",
    )
    db_session.add(entrada)
    db_session.commit()
    for _ in range(CIRCUITO_CLOUDINARY_UMBRAL_FALLOS):
        cc._circuito_cloudinary.registrar_fallo()

    with patch("app.infraestructura.cloudinary_cliente.cloudinary.uploader.destroy") as destroy:
        response = client.delete(f"{RUTA}{entrada.id}")

    assert response.status_code == 503
    assert destroy.call_count == 0
    assert db_session.get(EntradaGaleria, entrada.id) is not None


# --- Lectura acotada de la imagen (mismo criterio que sponsors, #824) -------

def test_subir_imagen_un_byte_sobre_el_tope_da_400_antes_de_cloudinary(client, monkeypatch):
    """cap+1: se rechaza con 400 y sin gastar la llamada al proveedor."""
    subidas = _registrar_subidas(monkeypatch)
    contenido = b"\xff\xd8\xff" + b"\x00" * (GaleriaServicio.TAMANO_MAXIMO_IMAGEN_BYTES - 2)
    assert len(contenido) == GaleriaServicio.TAMANO_MAXIMO_IMAGEN_BYTES + 1

    response = client.post(
        RUTA,
        data={"titulo": "Torneo", "descripcion": "Cierre anual"},
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )

    assert response.status_code == 400
    assert "tamaño" in response.json()["detail"].lower()
    assert subidas == []


def test_subir_imagen_exactamente_en_el_tope_se_acepta(client, monkeypatch):
    """cap: el corte es "excede", no "alcanza" -- una imagen de exactamente
    `TAMANO_MAXIMO_IMAGEN_BYTES` sigue siendo válida."""
    subidas = _registrar_subidas(monkeypatch)
    contenido = b"\xff\xd8\xff" + b"\x00" * (GaleriaServicio.TAMANO_MAXIMO_IMAGEN_BYTES - 3)
    assert len(contenido) == GaleriaServicio.TAMANO_MAXIMO_IMAGEN_BYTES

    response = client.post(
        RUTA,
        data={"titulo": "Torneo", "descripcion": "Cierre anual"},
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )

    assert response.status_code == 201, response.text
    assert len(subidas) == 1


def test_el_400_por_tope_excedido_es_identico_al_de_los_otros_endpoints(client, monkeypatch):
    """Criterio de aceptación de #824: el rechazo por tope debe producir la
    MISMA respuesta que los otros endpoints de subida, "para que el frontend
    no tenga que distinguir casos". Se compara contra `POST /auth/me/foto`,
    que comparte el tope de 5 MB."""
    _registrar_subidas(monkeypatch)
    assert (
        GaleriaServicio.TAMANO_MAXIMO_IMAGEN_BYTES
        == AuthServicio.TAMANO_MAXIMO_FOTO_PERFIL_BYTES
    )
    contenido = b"\xff\xd8\xff" + b"\x00" * GaleriaServicio.TAMANO_MAXIMO_IMAGEN_BYTES

    respuesta_galeria = client.post(
        RUTA,
        data={"titulo": "Torneo", "descripcion": "Cierre anual"},
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )
    respuesta_foto = client.post(
        "/api/v1/auth/me/foto",
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )

    assert respuesta_galeria.status_code == 400
    assert respuesta_foto.status_code == 400
    assert respuesta_galeria.json() == respuesta_foto.json()


# --- Verificación de firma binaria (mismo criterio que sponsors) ------------

def test_subir_imagen_con_firma_que_no_coincide_da_400_antes_de_cloudinary(client, monkeypatch):
    """El cliente declara `image/jpeg` pero el contenido real no tiene la
    firma binaria de un JPEG -- debe rechazarse ANTES de llamar a Cloudinary,
    con el mismo mensaje que los otros caminos de subida."""
    subidas = _registrar_subidas(monkeypatch)
    contenido = b"esto no es una imagen real" + b"\x00" * 50

    response = client.post(
        RUTA,
        data={"titulo": "Torneo", "descripcion": "Cierre anual"},
        files={"archivo": ("foto.jpg", contenido, "image/jpeg")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "El contenido del archivo no coincide con el formato declarado"
    )
    assert subidas == []


def test_subir_imagen_png_declarado_con_bytes_jpeg_da_400(client, monkeypatch):
    """La contracara: los bytes son una imagen real y válida, pero de OTRO
    formato del catálogo permitido. La firma detectada manda sobre el tipo
    declarado, no al revés."""
    subidas = _registrar_subidas(monkeypatch)

    response = client.post(
        RUTA,
        data={"titulo": "Torneo", "descripcion": "Cierre anual"},
        files={"archivo": ("foto.png", JPEG_VALIDO, "image/png")},
    )

    assert response.status_code == 400
    assert "no coincide" in response.json()["detail"].lower()
    assert subidas == []


def test_subir_imagen_vacia_da_400_sin_hablar_del_formato(client, monkeypatch):
    """Un archivo de 0 bytes no coincide con la firma de NINGÚN tipo; el
    chequeo de contenido vacío corre primero y su mensaje es el correcto
    (mismo criterio que `test_sponsors.py`)."""
    subidas = _registrar_subidas(monkeypatch)

    response = client.post(
        RUTA,
        data={"titulo": "Torneo", "descripcion": "Cierre anual"},
        files={"archivo": ("foto.png", b"", "image/png")},
    )

    assert response.status_code == 400
    detalle = response.json()["detail"].lower()
    assert "obligatori" in detalle
    assert "no coincide" not in detalle
    assert subidas == []
