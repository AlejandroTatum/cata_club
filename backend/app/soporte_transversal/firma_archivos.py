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
