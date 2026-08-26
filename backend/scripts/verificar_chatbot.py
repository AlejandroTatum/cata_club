"""
Smoke check NO SENSIBLE del proveedor del chatbot de FAQ (issue #645).

Corre dentro del contenedor backend, donde vive el proceso que atiende las
consultas:

    docker compose exec backend uv run python scripts/verificar_chatbot.py

Responde una sola pregunta -- "¿la clave del proveedor llegó al proceso y
puede ser una credencial?" -- y la responde SIN mirar la red y SIN imprimir
el secreto. Deliberadamente NO hace una consulta real al gateway: eso gastaría
tokens en cada deploy, agregaría una dependencia externa a un chequeo de
operación y metería la clave en una request cuyo error puede terminar en un
log. La validez de la credencial la confirma el uso real del chatbot; lo que
esta comprobación descarta es la clase de fallo que nadie ve, porque el
chatbot degrada en silencio a su FAQ local cuando la clave está mal.

Códigos de salida, pensados para encadenarlo en un script de despliegue:

    0  configurada  (o ausente sin `--exigir`: el club no habilitó el chatbot)
    1  incompleta   (SIEMPRE un error del operador; nunca es una decisión)
    2  ausente      y se pasó `--exigir`

`--exigir` es lo que distingue los dos despliegues legítimos: el que habilitó
el asistente externo y quiere que la falta de clave falle, y el que no lo
habilitó y para el que la ausencia es la configuración correcta.
"""
import argparse
import sys
from pathlib import Path

# Mismo montaje que `crear_primer_admin.py`: al invocar el script POR RUTA
# (`python scripts/verificar_chatbot.py`, que es como lo documenta el runbook
# y como lo corre `docker compose exec`), `sys.path[0]` es `scripts/`, no la
# raíz del backend, y `app` no se puede importar.
_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.soporte_transversal.diagnostico_chatbot import (  # noqa: E402
    EstadoProveedor,
    diagnosticar_configuracion_actual,
)

CODIGO_OK = 0
CODIGO_INCOMPLETA = 1
CODIGO_AUSENTE_EXIGIDA = 2

_ENCABEZADO = "Proveedor del chatbot de FAQ (gateway OpenCode Zen)"


def _parsear(argv):
    parser = argparse.ArgumentParser(
        description=(
            "Comprueba, sin imprimir el secreto ni contactar la red, que la "
            "clave del proveedor del chatbot llegó al backend."
        )
    )
    parser.add_argument(
        "--exigir",
        action="store_true",
        help=(
            "falla también cuando la clave está ausente (para despliegues que "
            "SÍ habilitaron el chatbot)"
        ),
    )
    return parser.parse_args(argv)


def main(argv=None, *, diagnosticar_ahora=diagnosticar_configuracion_actual, escribir=print):
    opciones = _parsear(argv)
    diagnostico = diagnosticar_ahora()

    escribir(_ENCABEZADO)
    for linea in diagnostico.lineas():
        escribir(f"  {linea}")

    if diagnostico.estado is EstadoProveedor.INCOMPLETA:
        return CODIGO_INCOMPLETA
    if diagnostico.estado is EstadoProveedor.AUSENTE and opciones.exigir:
        escribir(
            "  se pasó --exigir: este despliegue declara que el chatbot está "
            "habilitado, así que la ausencia de clave es un fallo."
        )
        return CODIGO_AUSENTE_EXIGIDA
    return CODIGO_OK


if __name__ == "__main__":
    sys.exit(main())
