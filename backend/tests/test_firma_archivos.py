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


# --- Decodificación real del contenido (FAM-03) -----------------------------
# La firma sola deja pasar un archivo corrupto con cabecera válida.
from tests.archivos_validos import jpeg_valido, pdf_valido, png_valido  # noqa: E402

from app.soporte_transversal.firma_archivos import es_contenido_legible  # noqa: E402


def test_jpeg_real_es_legible():
    assert es_contenido_legible(jpeg_valido(), "image/jpeg") is True


def test_png_real_es_legible():
    assert es_contenido_legible(png_valido(), "image/png") is True


def test_pdf_completo_es_legible():
    assert es_contenido_legible(pdf_valido(), "application/pdf") is True


def test_jpeg_con_firma_valida_pero_cuerpo_corrupto_no_es_legible():
    contenido = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100
    assert es_firma_valida(contenido, "image/jpeg") is True
    assert es_contenido_legible(contenido, "image/jpeg") is False


def test_png_truncado_no_es_legible():
    contenido = png_valido()[:-20]
    assert es_contenido_legible(contenido, "image/png") is False


def test_jpeg_truncado_no_es_legible():
    contenido = jpeg_valido()
    assert es_contenido_legible(contenido[: len(contenido) // 2], "image/jpeg") is False


def test_imagen_cuyo_formato_real_no_es_el_declarado_no_es_legible():
    """Un PNG real declarado como JPEG: la firma ya lo rechaza, y el decoder
    también si alguien lo llamara solo."""
    assert es_contenido_legible(png_valido(), "image/jpeg") is False


def test_pdf_con_solo_la_cabecera_no_es_legible():
    assert es_contenido_legible(b"%PDF-1.4\n" + b"\x00" * 100, "application/pdf") is False


def test_mime_fuera_de_catalogo_no_es_legible():
    assert es_contenido_legible(jpeg_valido(), "text/plain") is False
