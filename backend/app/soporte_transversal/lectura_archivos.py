"""
Lectura acotada de archivos subidos por el cliente (decisión de diseño 2.3,
sdd/production-readiness). Reemplaza el `await archivo.read()` sin límite
que antes bufferizaba el cuerpo completo en memoria ANTES de comparar su
tamaño contra el máximo permitido -- un cliente podía forzar al proceso a
materializar un archivo arbitrariamente grande en RAM antes de que el
chequeo de tamaño siquiera corriera.

Dos capas, ambas necesarias:
  1. `archivo.size`, si Starlette ya lo conoce (lo va acumulando mientras el
     parser multipart escribe el archivo), permite rechazar SIN leer nada.
  2. Lectura en bloques de `TAMANIO_BLOQUE` bytes con total acumulado: se
     aborta apenas se cruza `limite`, sin agotar el resto del archivo. El
     pico de memoria es `limite + TAMANIO_BLOQUE`, nunca lo que decida el
     cliente.
"""
from fastapi import UploadFile

from app.dominio.excepciones import OperacionInvalida

TAMANIO_BLOQUE = 65536  # 64 KB


async def leer_con_limite(archivo: UploadFile, limite: int) -> bytes:
    """Lee `archivo` en bloques sin superar `limite` bytes. Lanza
    `OperacionInvalida` (400) si el contenido excede `limite`, sin haber
    bufferizado el archivo completo en memoria."""
    if archivo.size is not None and archivo.size > limite:
        raise OperacionInvalida(
            f"El archivo excede el tamaño máximo permitido de {limite} bytes"
        )

    contenido = bytearray()
    while True:
        fragmento = await archivo.read(TAMANIO_BLOQUE)
        if not fragmento:
            break
        contenido.extend(fragmento)
        if len(contenido) > limite:
            raise OperacionInvalida(
                f"El archivo excede el tamaño máximo permitido de {limite} bytes"
            )
    return bytes(contenido)
