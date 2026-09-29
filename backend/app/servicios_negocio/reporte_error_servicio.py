"""Validación de contenido sensible enviado voluntariamente (#1401)."""
import re

MAX_CAPTURA = 2 * 1024 * 1024
_REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")


def validar_request_id(valor: str | None) -> str | None:
    if valor is not None and not _REQUEST_ID.fullmatch(valor):
        raise ValueError("X-Request-ID inválido")
    return valor


def validar_captura(mime: str, contenido: bytes) -> None:
    firmas = {
        "image/png": contenido.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": contenido.startswith(b"\xff\xd8\xff"),
        "image/webp": contenido.startswith(b"RIFF") and contenido[8:12] == b"WEBP",
    }
    if not 0 < len(contenido) <= MAX_CAPTURA or not firmas.get(mime, False):
        raise ValueError("Captura inválida (PNG, JPEG o WebP, máximo 2 MB)")
