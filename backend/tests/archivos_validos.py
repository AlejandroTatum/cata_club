"""
Archivos reales mínimos para los tests de subida.

Los comprobantes ya no se aceptan solo por su firma binaria: se decodifican
(`firma_archivos.es_contenido_legible`). Un fixture `b"\\xff\\xd8\\xff" + ceros`
tiene la firma de un JPEG pero no es un JPEG, así que los tests que necesitan
una subida VÁLIDA usan estos bytes, generados con Pillow.
"""
import io

from PIL import Image


def jpeg_valido() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (200, 30, 30)).save(buffer, format="JPEG")
    return buffer.getvalue()


def png_valido() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (30, 30, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def pdf_valido() -> bytes:
    return b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"
