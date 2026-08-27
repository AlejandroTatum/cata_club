"""
Smoke check de ENTREGA de un PDF contra la cuenta real de Cloudinary.

Corre dentro del contenedor backend, que es el proceso que firma las URLs:

    docker compose exec backend uv run python scripts/verificar_entrega_pdf.py

Por qué existe: los tests de `cloudinary_cliente.py` firman la URL y la
inspeccionan, pero NUNCA la descargan -- firmar es HMAC local, no toca la red.
Ese punto ciego dejó pasar dos fallos de entrega seguidos, los dos con firma
perfectamente válida y el log del backend limpio: el `folder` que faltaba en
el `public_id` (issue #480, `404`) y la cuenta que deniega todo PDF servido
por la CDN (`401` con `x-cld-error: deny or ACL failure` y `content-length:
0`). Ningún mock podía revelarlos: son detalles del vendor y de la
configuración de la cuenta, no de este código.

Lo que hace, y es todo lo que hace: sube un PDF mínimo desechable POR EL
MISMO camino que un comprobante oficial (`subir_pdf_membresia`), pide la URL
de entrega POR EL MISMO camino que la respuesta HTTP (`resolver_url_entrega`),
la DESCARGA de verdad y comprueba que vuelven bytes de PDF. Después borra el
recurso, pase lo que pase.

No imprime la URL firmada ni la credencial: la URL lleva la `api_key` en el
query string y es un link de descarga vivo durante
`CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS`; un chequeo de operación no tiene
por qué dejarlo en un log.

Códigos de salida, pensados para encadenarlo en un script de despliegue:

    0  la entrega funciona (o Cloudinary no está configurado y no se exigió)
    1  la entrega FALLA -- el socio no puede abrir sus PDF
    2  Cloudinary no está configurado y se pasó `--exigir`

`--exigir` distingue los dos despliegues legítimos, igual que en
`verificar_chatbot.py`: el que subió credenciales de Cloudinary y quiere que
su ausencia falle, y el entorno de desarrollo donde no tenerlas es válido
(Cloudinary es opcional por diseño; las subidas fallan a demanda).
"""
import argparse
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

# Mismo montaje que `verificar_chatbot.py`: al invocar el script POR RUTA
# (`python scripts/verificar_entrega_pdf.py`, que es como lo corre
# `docker compose exec`), `sys.path[0]` es `scripts/`, no la raíz del backend,
# y `app` no se puede importar.
_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

import cloudinary.uploader  # noqa: E402

from app.infraestructura.cloudinary_cliente import (  # noqa: E402
    resolver_url_entrega,
    subir_pdf_membresia,
)
from app.soporte_transversal.configuracion import settings  # noqa: E402

CODIGO_OK = 0
CODIGO_ENTREGA_ROTA = 1
CODIGO_AUSENTE_EXIGIDA = 2

_ENCABEZADO = "Entrega de PDF por Cloudinary (comprobante oficial y voucher en PDF)"

# PDF mínimo pero válido: alcanza para que Cloudinary lo indexe como `.pdf` y
# para reconocer los bytes que vuelven. No se lee ningún archivo del disco
# para que el chequeo no dependa de un fixture que alguien pueda mover.
_PDF_MINIMO = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n"
    b"%%EOF\n"
)

_MAGIC_PDF = b"%PDF-"
_TIMEOUT_DESCARGA_SEGUNDOS = 20


class EntregaRota(RuntimeError):
    """La URL de entrega no devolvió un PDF. El mensaje ya viene sin secretos."""


def hay_credenciales() -> bool:
    """Mismo criterio que `resolver_url_entrega` para degradar a `None`."""
    return bool(
        settings.cloudinary_cloud_name
        and settings.cloudinary_api_key
        and settings.cloudinary_api_secret
    )


def descargar(url: str) -> tuple[int, bytes, str]:
    """GET real contra la URL de entrega. Un `4xx/5xx` NO es una excepción
    acá: el fallo que este chequeo persigue ES un código de estado, así que se
    devuelve como dato para poder reportarlo."""
    try:
        with urllib.request.urlopen(url, timeout=_TIMEOUT_DESCARGA_SEGUNDOS) as respuesta:  # noqa: S310
            return respuesta.status, respuesta.read(), respuesta.headers.get("x-cld-error", "")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), exc.headers.get("x-cld-error", "")
    except (OSError, urllib.error.URLError) as exc:
        raise EntregaRota(f"no se pudo contactar a Cloudinary para descargar el PDF: {exc}") from exc


def _borrar(public_id_completo: str) -> None:
    """Retira el recurso desechable. La app nunca borra comprobantes, así que
    esto va directo al SDK en vez de agregarle un borrado al adaptador."""
    cloudinary.uploader.destroy(
        public_id_completo, resource_type="raw", type="authenticated", invalidate=True,
    )


def verificar_entrega(
    *,
    subir=subir_pdf_membresia,
    resolver=resolver_url_entrega,
    descargar_url=descargar,
    borrar=_borrar,
    escribir=print,
) -> None:
    """Sube, entrega, descarga y limpia. Levanta `EntregaRota` si el PDF no
    vuelve. Las dependencias se inyectan para poder probar el script sin
    tocar la cuenta real."""
    nombre_publico = f"verificacion-entrega-{uuid.uuid4().hex}"
    carpeta = settings.cloudinary_carpeta_comprobantes

    subir(_PDF_MINIMO, nombre_publico, sobreescribir=True)
    try:
        url = resolver(
            nombre_publico, resource_type="raw", folder=carpeta, formato="pdf",
        )
        if not url:
            raise EntregaRota(
                "`resolver_url_entrega` no devolvió una URL de entrega para el PDF."
            )

        estado, cuerpo, error_cloudinary = descargar_url(url)
        escribir(f"  descarga del PDF de prueba: HTTP {estado}, {len(cuerpo)} bytes")

        if estado != 200:
            detalle = f" ({error_cloudinary})" if error_cloudinary else ""
            raise EntregaRota(
                f"la URL de entrega del PDF respondió HTTP {estado}{detalle}. "
                "El comprobante oficial y el voucher en PDF NO se pueden abrir."
            )
        if not cuerpo.startswith(_MAGIC_PDF):
            raise EntregaRota(
                f"la URL de entrega respondió 200 pero sin bytes de PDF "
                f"({len(cuerpo)} bytes). Cloudinary devolvió otra cosa."
            )
    finally:
        # Se borra también cuando la entrega falla: un chequeo de operación no
        # puede ir dejando recursos sueltos en la carpeta de comprobantes.
        try:
            borrar(f"{carpeta}/{nombre_publico}.pdf")
        except Exception as exc:  # noqa: BLE001
            escribir(f"  aviso: no se pudo borrar el PDF de prueba ({exc}).")


def _parsear(argv):
    parser = argparse.ArgumentParser(
        description=(
            "Sube un PDF desechable a Cloudinary, lo descarga por la URL de "
            "entrega real y comprueba que vuelven bytes de PDF."
        )
    )
    parser.add_argument(
        "--exigir",
        action="store_true",
        help=(
            "falla también cuando Cloudinary no está configurado (para "
            "despliegues que SÍ suben comprobantes)"
        ),
    )
    return parser.parse_args(argv)


def main(argv=None, *, verificar=verificar_entrega, credenciales=hay_credenciales, escribir=print):
    opciones = _parsear(argv)
    escribir(_ENCABEZADO)

    if not credenciales():
        escribir("  Cloudinary no está configurado en este proceso; no hay entrega que probar.")
        if opciones.exigir:
            escribir(
                "  se pasó --exigir: este despliegue declara que sube comprobantes, "
                "así que la ausencia de credenciales es un fallo."
            )
            return CODIGO_AUSENTE_EXIGIDA
        return CODIGO_OK

    try:
        verificar(escribir=escribir)
    except EntregaRota as exc:
        escribir(f"  FALLA: {exc}")
        return CODIGO_ENTREGA_ROTA

    escribir("  la URL de entrega devolvió el PDF completo.")
    return CODIGO_OK


if __name__ == "__main__":
    sys.exit(main())
