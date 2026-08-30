"""
Tests unitarios de `soporte_transversal/lectura_archivos.py` (PR-08,
sdd/production-readiness, REQ-SEC-3): la lectura de un `UploadFile` debe
acotarse a un límite de bytes SIN bufferizar el archivo completo en memoria
primero. Se usa un doble de prueba (`_ArchivoFalso`) en vez de un
`UploadFile` real para poder probar los casos límite (cap-1/cap/cap+1) de
forma determinística y espiar cuántas veces se llamó a `.read()`.
"""
import ast
import asyncio
from pathlib import Path

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


# --- Candado de paridad de las lecturas de upload (issue #824) --------------
# `leer_con_limite` se introdujo DESPUÉS de que existiera el endpoint de
# sponsors y se aplicó a los tres uploads que había en ese momento; el de
# sponsors quedó afuera durante meses sin que nada avisara. La asimetría era
# la prueba del olvido: no había ningún comentario que la justificara. Este
# candado la vuelve imposible de repetir en silencio para el próximo upload
# que se agregue.

# `lectura_archivos.py` es la ÚNICA exención legítima de todo `app/`:
# `leer_con_limite` ES la implementación del tope, y para acotar tiene que
# pedirle bloques al archivo (`archivo.read(TAMANIO_BLOQUE)`). Agregar un
# módulo acá es una decisión consciente que hay que justificar; el candado no
# se afloja para acomodar un call site nuevo.
_MODULOS_EXENTOS = {"lectura_archivos.py"}


def _lecturas_crudas(arbol: ast.AST) -> list[int]:
    """Líneas con una llamada a `.read(...)` sobre CUALQUIER receptor.

    Se recorre el AST y no el texto: un `.read()` citado dentro de un
    comentario o un docstring -- por ejemplo el que documenta ESTE candado --
    no es código y no debe contar como infracción.

    La regla ignora deliberadamente los argumentos y el `await`. Mirarlos
    (`.read()` sin argumentos y precedido de `ast.Await`, como en la primera
    versión de este candado) deja tres agujeros exactos, y son justo las tres
    formas por las que se reintroduce el #824:

      - `await archivo.read(-1)`: Starlette reenvía el `size` tal cual a
        `self.file.read(-1)`, que es la lectura TOTAL, sin cota ninguna.
      - `await archivo.read(archivo.size)`: acota al tamaño que declaró el
        cliente, o sea a nada.
      - `archivo.file.read()`: el `SpooledTemporaryFile` de abajo, sincrónico
        -- no hay ningún nodo `ast.Await` que filtrar.

    La lectura correcta no cae acá por construcción: `leer_con_limite(archivo,
    <tope>)` es una llamada a una función, no un atributo `.read` de nadie.
    """
    return sorted(
        nodo.lineno
        for nodo in ast.walk(arbol)
        if isinstance(nodo, ast.Call)
        and isinstance(nodo.func, ast.Attribute)
        and nodo.func.attr == "read"
    )


def test_ningun_modulo_lee_un_upload_sin_limite():
    """Ningún módulo de `app/` puede llamar a `.read()` sobre el archivo
    subido: la lectura de un `UploadFile` va siempre por `leer_con_limite`,
    que corta apenas se cruza el tope en vez de materializar en RAM lo que
    decida el cliente.

    El barrido es sobre `app/` COMPLETO y recursivo, no sobre
    `presentacion/routers/*.py`: un router en un subdirectorio, o un servicio
    que reciba el `UploadFile` en vez de los bytes ya leídos, quedaban fuera
    de un candado que decía cubrir "los routers"."""
    directorio_app = Path(__file__).resolve().parents[1] / "app"

    infractores = {
        str(ruta.relative_to(directorio_app)): lineas
        for ruta in sorted(directorio_app.rglob("*.py"))
        if ruta.name not in _MODULOS_EXENTOS
        and (lineas := _lecturas_crudas(ast.parse(ruta.read_text(encoding="utf-8"))))
    }

    assert infractores == {}, (
        "estos módulos leen el archivo subido sin límite; usá "
        "`await leer_con_limite(archivo, <tope>)` en su lugar: "
        f"{infractores}"
    )
