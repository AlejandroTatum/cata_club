"""
Tests unitarios de `soporte_transversal/firma_archivos.py` (PR-08,
sdd/production-readiness, REQ-SEC-3): el `Content-Type` que declara el
cliente en un upload no prueba nada sobre el contenido real -- estos tests
verifican la tabla de firmas binarias que sí lo hace.
"""
from app.soporte_transversal.firma_archivos import es_firma_valida


def test_firma_jpeg_valida_es_aceptada():
    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 50
    assert es_firma_valida(contenido, "image/jpeg") is True


def test_firma_png_valida_es_aceptada():
    contenido = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
    assert es_firma_valida(contenido, "image/png") is True


def test_firma_pdf_valida_es_aceptada():
    contenido = b"%PDF-1.4\n" + b"\x00" * 50
    assert es_firma_valida(contenido, "application/pdf") is True


def test_firma_no_coincide_con_el_mime_declarado_es_rechazada():
    """Declara JPEG pero el contenido real es texto plano -- el escenario
    de la firma exacto que este check existe para bloquear."""
    contenido = b"esto no es una imagen, es texto plano"
    assert es_firma_valida(contenido, "image/jpeg") is False


def test_mime_declarado_no_esta_en_la_tabla_es_rechazado():
    """Un `Content-Type` fuera del catálogo permitido (ej. `text/plain`)
    nunca puede ser válido, sin importar el contenido."""
    contenido = b"\xff\xd8\xff\xe0"
    assert es_firma_valida(contenido, "text/plain") is False
