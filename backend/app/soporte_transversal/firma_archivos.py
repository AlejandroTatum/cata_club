"""
Validación de firma binaria (magic bytes) de archivos subidos por el
cliente (decisión de diseño 2.3, sdd/production-readiness). El
`Content-Type` que declara el cliente en el request es un dato que el
cliente controla por completo -- no prueba nada sobre el contenido real.
Esta tabla compara los primeros bytes del archivo contra la firma conocida
de cada formato permitido; la firma detectada es la que manda, el
`Content-Type` declarado solo determina QUÉ firma se espera.

Se usa una tabla propia en vez de `python-magic` (que trae libmagic, una
dependencia C) porque el catálogo permitido es acotado -- 3 formatos, todos
con firma fija en el offset 0. Una tabla de 3 entradas no trae riesgo de
wheel/ABI y es trivial de testear. Revisar esta decisión si el catálogo
permitido crece a ~6 formatos o más.
"""
import io

from PIL import Image

FIRMAS_POR_MIME: dict[str, tuple[bytes, ...]] = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "application/pdf": (b"%PDF-",),
}


def es_firma_valida(contenido: bytes, mime_declarado: str) -> bool:
    """`True` si `contenido` empieza con la firma binaria conocida de
    `mime_declarado`. `False` si el MIME declarado no está en la tabla, o si
    los bytes reales no coinciden con ninguna firma válida para ese tipo."""
    firmas = FIRMAS_POR_MIME.get(mime_declarado)
    if not firmas:
        return False
    return any(contenido.startswith(firma) for firma in firmas)


# Tope de píxeles que se decodifican de un comprobante. El archivo pesa como
# máximo 5MB, pero un PNG o JPEG pequeño puede declarar dimensiones enormes
# (bomba de descompresión): decodificarlo reservaría cientos de MB. 64 MP cubre
# cualquier foto de celular real.
MAX_PIXELES_DECODIFICADOS = 64_000_000

# El estándar pide `%%EOF` al final del archivo; los lectores toleran basura
# posterior hasta este margen. Un PDF cortado a mitad de subida lo pierde.
_VENTANA_FIN_PDF = 1024

_FORMATO_PIL_POR_MIME = {"image/jpeg": "JPEG", "image/png": "PNG"}


def es_contenido_legible(contenido: bytes, mime_declarado: str) -> bool:
    """`True` si `contenido` realmente se puede abrir como `mime_declarado`.

    La firma (`es_firma_valida`) solo mira los primeros bytes: un archivo
    corrupto o truncado con cabecera válida la pasa. Acá se decodifica:

    - Imágenes: Pillow `verify()` (integridad de la estructura) y luego una
      decodificación completa con `load()`, que además detecta datos cortados.
      El formato detectado debe ser el declarado.
    - PDF: no hay un lector de PDF entre las dependencias del proyecto, así que
      NO se decodifica; se exige la estructura mínima de un archivo completo
      (cabecera `%PDF-` y marcador `%%EOF` al final). Es una comprobación de
      que no está cortado, no una validación de su contenido.
    """
    if not contenido or not es_firma_valida(contenido, mime_declarado):
        return False
    if mime_declarado == "application/pdf":
        return b"%%EOF" in contenido[-_VENTANA_FIN_PDF:]
    formato = _FORMATO_PIL_POR_MIME.get(mime_declarado)
    if formato is None:
        return False
    try:
        with Image.open(io.BytesIO(contenido)) as imagen:
            if imagen.format != formato:
                return False
            ancho, alto = imagen.size
            if ancho * alto > MAX_PIXELES_DECODIFICADOS:
                return False
            imagen.verify()
        # `verify()` deja la imagen inutilizable: se reabre para decodificar.
        with Image.open(io.BytesIO(contenido)) as imagen:
            imagen.load()
    except Exception:  # noqa: BLE001 -- Pillow lanza tipos dispares ante datos corruptos
        return False
    return True
