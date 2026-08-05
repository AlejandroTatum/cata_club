"""
Adaptador de persistencia de archivos: Cloudinary.

Encapsula el SDK `cloudinary` y `cloudinary.uploader` para que el resto del
código dependa de una interfaz propia (no del SDK directo). Esto facilita tests
(reemplazable por un double) y protege al dominio de detalles de vendor.

Recurso PDF en Cloudinary:
    Cloudinary trata los PDF como `resource_type="raw"` (los `image` son para
    formatos raster/vector procesables). Por eso el upload usa raw.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import cloudinary
import cloudinary.uploader
from urllib3.util import Timeout

from app.dominio.excepciones import ServicioNoDisponible
from app.soporte_transversal.circuito_breaker import CircuitoBreaker
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import (
    CIRCUITO_CLOUDINARY_COOLDOWN_SEGUNDOS,
    CIRCUITO_CLOUDINARY_UMBRAL_FALLOS,
    TIMEOUT_CLOUDINARY_CONEXION_SEGUNDOS,
    TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
    UMBRAL_SUBIDA_LENTA_SEGUNDOS,
)


logger = logging.getLogger("cataclub.cloudinary")

# Circuit breaker en proceso (degradacion-controlada, slice 2): una única
# instancia a nivel de módulo, compartida por las 3 funciones públicas de
# este módulo porque todas pasan por `_subir()`. Ver Decisión E del diseño:
# estado en memoria + reloj monotónico + lock, sin Redis compartido -- un
# solo proceso Uvicorn y Celery con `--concurrency=2` no lo necesitan.
_circuito_cloudinary = CircuitoBreaker(
    nombre="cloudinary",
    umbral_fallos=CIRCUITO_CLOUDINARY_UMBRAL_FALLOS,
    cooldown_segundos=CIRCUITO_CLOUDINARY_COOLDOWN_SEGUNDOS,
)


def _configurar_cliente() -> None:
    """Inicializa el cliente de Cloudinary con las credenciales del entorno.
    Idempotente: re-aplicar la config sobreescribe pero no corrompe el state."""
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,  # SIEMPRE HTTPS para las URLs públicas devueltas
    )


def _subir(contenido: bytes, upload_kwargs: dict, descripcion: str) -> str:
    """ÚNICO punto donde este módulo llama al SDK. Un solo intento: sin
    reintento. En la ruta de request quien reintenta es la persona (botón en
    el front); en la ruta de tarea reintenta Celery (autoretry_for + backoff,
    comprobante_tareas.py:42-45). Un tercer reintento acá multiplicaría los
    intentos contra el proveedor sin resolver nada.

    Antes de llamar al SDK se consulta el circuit breaker
    (`_circuito_cloudinary`, degradacion-controlada slice 2): si está
    ABIERTO, esta función NUNCA llama al SDK -- solo levanta
    `ServicioNoDisponible` de inmediato. Esto NO es un reintento ni lo
    contradice: el breaker decide si se hace el único intento permitido, no
    agrega un segundo intento sobre uno que ya falló.

    El `timeout` es un `urllib3.util.Timeout` (no un float): un float se
    convierte en `Timeout(read=t, connect=t)` per-operación de socket, sin
    cota de reloj de pared real (`urllib3/util/timeout.py:186`). Solo una
    instancia de `Timeout` respeta el `total=` (`connectionpool.py:351`).
    Nota: `total=` no cubre completamente la fase de ENVÍO del cuerpo del
    request — un cuerpo que fluye sin nunca estancarse 3s queda sin cota en
    esa fase específica; documentado, no resuelto (ver diseño).
    """
    if not _circuito_cloudinary.permitir():
        raise ServicioNoDisponible(
            f"Cloudinary no disponible (circuito abierto): {descripcion}"
        )

    timeout = Timeout(
        connect=TIMEOUT_CLOUDINARY_CONEXION_SEGUNDOS,
        read=TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
        total=TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
    )

    inicio = time.perf_counter()
    try:
        resultado = cloudinary.uploader.upload(contenido, timeout=timeout, **upload_kwargs)
    except Exception as exc:
        _circuito_cloudinary.registrar_fallo()
        logger.exception("Fallo subiendo %s a Cloudinary", descripcion)
        raise ServicioNoDisponible(f"Error subiendo {descripcion} a Cloudinary: {exc}") from exc

    url: Optional[str] = resultado.get("secure_url")
    if not url:
        # Defensive: si el SDK no devuelve secure_url (imposible con secure=True),
        # lo tratamos como una anomalía del vendor, no del caller.
        _circuito_cloudinary.registrar_fallo()
        raise ServicioNoDisponible(f"Cloudinary no retornó `secure_url` ({descripcion})")

    _circuito_cloudinary.registrar_exito()

    elapsed = time.perf_counter() - inicio
    if elapsed >= UMBRAL_SUBIDA_LENTA_SEGUNDOS:
        logger.warning("Subida lenta a Cloudinary (%s, %.2fs): %s", descripcion, elapsed, url)
    else:
        logger.info("Subida a Cloudinary (%s, %.2fs): %s", descripcion, elapsed, url)
    return url


def subir_pdf_membresia(
    contenido_pdf: bytes,
    nombre_publico: str,
    sobreescribir: bool = False,
) -> str:
    """
    Sube un PDF (en bytes, en memoria) a Cloudinary como recurso `raw` y
    devuelve la URL pública segura (https).

    Args:
        contenido_pdf: bytes en memoria del PDF (NO toca el disco del server).
        nombre_publico: public_id que tendrá el recurso en Cloudinary.
        sobreescribir: si True, permite pisar un public_id ya existente.

    Returns:
        URL pública HTTPS del recurso subido (ej.
        https://res.cloudinary.com/<cloud>/raw/upload/<id>.pdf).
    """
    _configurar_cliente()

    if not contenido_pdf:
        raise ValueError("El contenido del PDF está vacío; no se puede subir.")

    upload_kwargs = {
        "resource_type": "raw",
        "public_id": nombre_publico,
        "folder": settings.cloudinary_carpeta_comprobantes,
        "overwrite": sobreescribir,
        "invalidate": True,  # invalida la CDN al sobreescribir
        # Forzamos el formato `.pdf` porque Cloudinary no lo agrega solo en raw.
        "format": "pdf",
    }

    return _subir(
        contenido_pdf, upload_kwargs, f"PDF de membresía (public_id={nombre_publico})"
    )


def subir_voucher_pago(
    contenido: bytes,
    nombre_publico: str,
    content_type: str,
    pago_id: int,
) -> str:
    """
    Sube el voucher/comprobante de transferencia que adjunta el cliente
    (no el PDF oficial generado por el sistema al aprobar un pago — ese usa
    `subir_pdf_membresia`).

    Mapeo por tipo MIME:
      - application/pdf -> resource_type="raw", format="pdf"
      - image/jpeg | image/png -> resource_type="image" (se respeta el formato
        original del cliente; Cloudinary lo detecta, no se fuerza `format`).

    Carpeta destino: `settings.cloudinary_carpeta_vouchers` (separada de la
    carpeta de comprobantes PDF oficiales), para no mezclar conceptos.
    `overwrite=True` + `invalidate=True` permiten al cliente corregir un
    voucher subido erróneamente mientras el pago siga PENDIENTE_VALIDACION.

    Returns:
        URL pública HTTPS del recurso subido.
    """
    _configurar_cliente()

    if not contenido:
        raise ValueError("El contenido del voucher está vacío; no se puede subir.")

    if content_type == "application/pdf":
        upload_kwargs = {
            "resource_type": "raw",
            "public_id": nombre_publico,
            "folder": settings.cloudinary_carpeta_vouchers,
            "overwrite": True,
            "invalidate": True,
            "format": "pdf",
        }
    elif content_type in ("image/jpeg", "image/png"):
        # resource_type="image": Cloudinary gestiona el formato y permite
        # thumbnails/transformaciones; no se fuerza `format` para respetar el
        # formato original (jpg/png) que trae el archivo del cliente.
        upload_kwargs = {
            "resource_type": "image",
            "public_id": nombre_publico,
            "folder": settings.cloudinary_carpeta_vouchers,
            "overwrite": True,
            "invalidate": True,
        }
    else:
        raise ValueError(f"Tipo MIME no soportado para voucher: {content_type}")

    return _subir(
        contenido, upload_kwargs,
        f"voucher de pago (pago_id={pago_id}, public_id={nombre_publico})",
    )


def subir_foto_perfil(
    contenido: bytes,
    nombre_publico: str,
    content_type: str,
    persona_id: int,
) -> str:
    """
    Sube la foto de perfil self-service de una Persona (Issue: foto de
    perfil propia). Mismo criterio de validación/subida que
    `subir_voucher_pago`, restringido a imágenes.

    Mapeo por tipo MIME: solo image/jpeg | image/png -> resource_type="image"
    (no se fuerza `format`, se respeta el original del cliente).

    Carpeta destino: `settings.cloudinary_carpeta_fotos_perfil` (separada de
    comprobantes/vouchers, para no mezclar conceptos).
    `overwrite=True` + `invalidate=True`: el `public_id` se deriva del
    `persona_id` del caller (mismo valor en cada subida), así una foto nueva
    SOBRESCRIBE la anterior en vez de acumular recursos huérfanos.

    Returns:
        URL pública HTTPS del recurso subido.
    """
    _configurar_cliente()

    if not contenido:
        raise ValueError("El contenido de la foto está vacío; no se puede subir.")

    if content_type not in ("image/jpeg", "image/png"):
        raise ValueError(f"Tipo MIME no soportado para foto de perfil: {content_type}")

    upload_kwargs = {
        "resource_type": "image",
        "public_id": nombre_publico,
        "folder": settings.cloudinary_carpeta_fotos_perfil,
        "overwrite": True,
        "invalidate": True,
    }

    return _subir(
        contenido, upload_kwargs,
        f"foto de perfil (persona_id={persona_id}, public_id={nombre_publico})",
    )
