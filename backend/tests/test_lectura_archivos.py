"""
Tests unitarios de `soporte_transversal/lectura_archivos.py` (PR-08,
sdd/production-readiness, REQ-SEC-3): la lectura de un `UploadFile` debe
acotarse a un límite de bytes SIN bufferizar el archivo completo en memoria
primero. Se usa un doble de prueba (`_ArchivoFalso`) en vez de un
`UploadFile` real para poder probar los casos límite (cap-1/cap/cap+1) de
forma determinística y espiar cuántas veces se llamó a `.read()`.
"""
import asyncio

import pytest

from app.dominio.excepciones import OperacionInvalida
from app.soporte_transversal.lectura_archivos import leer_con_limite


class _ArchivoFalso:
    """Simula la interfaz de `UploadFile` que usa `leer_con_limite`: entrega
    un fragmento de `fragmentos` por cada llamada a `.read()`, y registra
    cuántas llamadas recibió -- así se puede probar que la lectura se
    ABORTA antes de agotar todos los fragmentos disponibles."""

    def __init__(self, fragmentos: list[bytes], size: int | None = None):
        self._fragmentos = list(fragmentos)
        self.size = size
        self.llamadas_a_read = 0

    async def read(self, tamanio: int = -1) -> bytes:
        self.llamadas_a_read += 1
        if not self._fragmentos:
            return b""
        return self._fragmentos.pop(0)


def _leer(archivo: _ArchivoFalso, limite: int) -> bytes:
    return asyncio.run(leer_con_limite(archivo, limite))


def test_acepta_contenido_justo_debajo_del_limite():
    """cap-1: 9 bytes con límite 10 -> se lee completo, sin error."""
    archivo = _ArchivoFalso([b"123456789"])
    resultado = _leer(archivo, limite=10)
    assert resultado == b"123456789"


def test_acepta_contenido_exactamente_en_el_limite():
    """cap: 10 bytes con límite 10 -> se lee completo, sin error (el corte
    es "excede", no "alcanza")."""
    archivo = _ArchivoFalso([b"1234567890"])
    resultado = _leer(archivo, limite=10)
    assert resultado == b"1234567890"


def test_rechaza_contenido_que_supera_el_limite_por_un_byte_sin_agotar_fragmentos():
    """cap+1: 11 bytes con límite 10 -> `OperacionInvalida`, y la lectura se
    aborta ANTES de consumir el fragmento sobrante -- prueba que no hay un
    `.read()` sin límite escondido detrás."""
    archivo = _ArchivoFalso([b"123456789", b"XX", b"NUNCA_SE_LEE_ESTO"])
    with pytest.raises(OperacionInvalida):
        _leer(archivo, limite=10)
    # 9 + 2 = 11 bytes acumulados tras el 2do fragmento (> 10, se aborta
    # ahí): el 3er fragmento, que existe en el doble de prueba, nunca se
    # pidió.
    assert archivo.llamadas_a_read == 2


def test_usa_tamanio_ya_conocido_para_rechazar_sin_leer_nada():
    """Si Starlette ya conoce `archivo.size` (lo acumula mientras el parser
    multipart escribe el archivo), se rechaza SIN llamar a `.read()` ni una
    vez -- el gate barato de la decisión de diseño 2.3."""
    archivo = _ArchivoFalso([b"cualquier-cosa"], size=999)
    with pytest.raises(OperacionInvalida):
        _leer(archivo, limite=10)
    assert archivo.llamadas_a_read == 0
