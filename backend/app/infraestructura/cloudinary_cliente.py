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
from urllib.parse import urlparse

import cloudinary
import cloudinary.uploader
import cloudinary.utils
from urllib3.util import Timeout

from app.dominio.excepciones import ServicioNoDisponible
from app.soporte_transversal.circuito_breaker import CircuitoBreaker
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.resiliencia import (
    CIRCUITO_CLOUDINARY_COOLDOWN_SEGUNDOS,
    CIRCUITO_CLOUDINARY_UMBRAL_FALLOS,
    CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS,
    TIMEOUT_CLOUDINARY_CONEXION_SEGUNDOS,
    TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
    UMBRAL_SUBIDA_LENTA_SEGUNDOS,
)


logger = logging.getLogger("cataclub.cloudinary")


def _redactar_detalle_sensible(detalle: str) -> str:
    """Evita que errores del SDK copien credenciales configuradas a los logs."""
    for valor in (
        settings.cloudinary_api_key,
        settings.cloudinary_api_secret,
        settings.cloudinary_auth_token_key,
    ):
        if valor:
            detalle = detalle.replace(valor, "[REDACTED]")
    return detalle


# Mensaje de cara al usuario para CUALQUIER fallo de `_subir()` (issue #347):
# genérico a propósito porque cubre las 3 funciones públicas de este módulo
# (comprobante PDF, voucher de transferencia, foto de perfil) y CUALQUIER
# causa -- credencial ausente (`ValueError: Must supply api_key`), timeout,
# circuito abierto, o cualquier otra excepción del SDK. El texto del vendor
# NUNCA va acá: ver `_MENSAJE_ERROR_DOMINIO` en `_subir`, que lo manda a
# `detalle_tecnico` (log), no a `mensaje` (lo que `_MAPA_EXCEPCIONES` de
# main.py devuelve tal cual en el body de la respuesta 503).
_MENSAJE_SUBIDA_NO_DISPONIBLE = (
    "No se pudo subir el archivo en este momento. Vuelva a intentarlo más "
    "tarde o acérquese al club / escríbanos por WhatsApp."
)

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
            _MENSAJE_SUBIDA_NO_DISPONIBLE,
            detalle_tecnico=f"Cloudinary no disponible (circuito abierto): {descripcion}",
            seguro_mostrar=True,
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
        detalle = _redactar_detalle_sensible(str(exc))
        logger.error("Fallo subiendo %s a Cloudinary: %s", descripcion, detalle)
        # `mensaje` (lo que el socio lee) NUNCA lleva el detalle del vendor.
        # El detalle técnico puede llegar al log del manejador global, por
        # eso se redacta antes de guardarlo también en la excepción.
        raise ServicioNoDisponible(
            _MENSAJE_SUBIDA_NO_DISPONIBLE,
            detalle_tecnico=f"Error subiendo {descripcion} a Cloudinary: {detalle}",
            seguro_mostrar=True,
        ) from exc

    url: Optional[str] = resultado.get("secure_url")
    if not url:
        # Defensive: si el SDK no devuelve secure_url (imposible con secure=True),
        # lo tratamos como una anomalía del vendor, no del caller.
        _circuito_cloudinary.registrar_fallo()
        raise ServicioNoDisponible(
            _MENSAJE_SUBIDA_NO_DISPONIBLE,
            detalle_tecnico=f"Cloudinary no retornó `secure_url` ({descripcion})",
            seguro_mostrar=True,
        )

    _circuito_cloudinary.registrar_exito()

    elapsed = time.perf_counter() - inicio
    if elapsed >= UMBRAL_SUBIDA_LENTA_SEGUNDOS:
        logger.warning("Subida lenta a Cloudinary (%s, %.2fs)", descripcion, elapsed)
    else:
        logger.info("Subida a Cloudinary (%s, %.2fs)", descripcion, elapsed)
    return url


def subir_pdf_membresia(
    contenido_pdf: bytes,
    nombre_publico: str,
    sobreescribir: bool = False,
) -> str:
    """
    Sube un PDF (en bytes, en memoria) a Cloudinary como recurso `raw`,
    `type="authenticated"`, y devuelve la URL que retorna el SDK -- NO
    utilizable para servir el archivo (ver nota de seguridad abajo).

    Args:
        contenido_pdf: bytes en memoria del PDF (NO toca el disco del server).
        nombre_publico: public_id que tendrá el recurso en Cloudinary.
        sobreescribir: si True, permite pisar un public_id ya existente.

    Returns:
        URL que devuelve el SDK al subir (ej.
        https://res.cloudinary.com/<cloud>/raw/authenticated/<id>.pdf).
        NO es una URL de entrega válida: con `type="authenticated"`,
        Cloudinary la sirve solo si viene firmada (401 si no). El caller NO
        debe persistir este valor como "la URL del archivo" -- debe guardar
        `nombre_publico` y generar la URL de entrega en cada lectura
        autorizada con `generar_url_firmada` (hallazgo de privacidad
        "voucher no enumerable": un `public_id` secuencial bajo `type=upload`
        era una URL pública, enumerable sin autenticación).
    """
    _configurar_cliente()

    if not contenido_pdf:
        raise ValueError("El contenido del PDF está vacío; no se puede subir.")

    upload_kwargs = {
        "resource_type": "raw",
        "type": "authenticated",
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

    `type="authenticated"`: el comprobante bancario que sube la familia es
    dato sensible. Sin esto, cualquiera que conociera (o adivinara, ver
    `nombre_publico`) el `public_id` podía descargarlo sin pasar por ningún
    chequeo del backend (hallazgo de privacidad "voucher no enumerable").

    Returns:
        URL que devuelve el SDK al subir. NO es una URL de entrega válida
        (ver el docstring de `subir_pdf_membresia`, mismo criterio): el
        caller debe persistir `nombre_publico` y pedir la URL de entrega a
        `generar_url_firmada` en cada lectura autorizada.
    """
    _configurar_cliente()

    if not contenido:
        raise ValueError("El contenido del voucher está vacío; no se puede subir.")

    if content_type == "application/pdf":
        upload_kwargs = {
            "resource_type": "raw",
            "type": "authenticated",
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
            "type": "authenticated",
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

    `type="authenticated"` (issue #553, Problema 2): la foto de una persona
    (incluye menores) se subía como recurso público con `public_id`
    predecible (`perfil_{persona_id}`) -- enumerable sin autenticación,
    misma clase de hallazgo que "voucher no enumerable".

    Returns:
        URL que devuelve el SDK al subir. NO es una URL de entrega válida
        (ver el docstring de `subir_pdf_membresia`, mismo criterio): el
        caller debe persistir `nombre_publico` y resolver la URL de entrega
        con `resolver_url_foto_perfil` en cada lectura autorizada.
    """
    _configurar_cliente()

    if not contenido:
        raise ValueError("El contenido de la foto está vacío; no se puede subir.")

    if content_type not in ("image/jpeg", "image/png"):
        raise ValueError(f"Tipo MIME no soportado para foto de perfil: {content_type}")

    upload_kwargs = {
        "resource_type": "image",
        "type": "authenticated",
        "public_id": nombre_publico,
        "folder": settings.cloudinary_carpeta_fotos_perfil,
        "overwrite": True,
        "invalidate": True,
    }

    return _subir(
        contenido, upload_kwargs,
        f"foto de perfil (persona_id={persona_id}, public_id={nombre_publico})",
    )


def subir_logo_sponsor(contenido: bytes, nombre_publico: str, content_type: str) -> str:
    """Sube un logo deliberadamente público para su entrega en la landing."""
    _configurar_cliente()
    if not contenido:
        raise ValueError("El contenido del logo está vacío; no se puede subir.")
    if content_type not in ("image/jpeg", "image/png"):
        raise ValueError(f"Tipo MIME no soportado para logo de patrocinador: {content_type}")
    return _subir(contenido, {
        "resource_type": "image",
        "type": "upload",
        "public_id": nombre_publico,
        "folder": "cataclub/sponsors",
        "overwrite": False,
    }, f"logo de patrocinador (public_id={nombre_publico})")


def eliminar_logo_sponsor(nombre_publico: str) -> None:
    """Retira un logo público; la fila se borra solo si el proveedor responde."""
    _configurar_cliente()
    try:
        cloudinary.uploader.destroy(
            f"cataclub/sponsors/{nombre_publico}", resource_type="image", type="upload", invalidate=True,
        )
    except Exception as exc:
        logger.exception("Fallo eliminando logo de patrocinador de Cloudinary")
        raise ServicioNoDisponible(
            "No se pudo eliminar el logo del patrocinador. Intente nuevamente.",
            detalle_tecnico=f"Error eliminando logo sponsor {nombre_publico}: {exc}",
            seguro_mostrar=True,
        ) from exc


# --- URL de entrega firmada (hallazgo de privacidad "voucher no enumerable") -
def generar_url_firmada(
    public_id: str,
    resource_type: str,
    folder: str,
    formato: Optional[str] = None,
) -> str:
    """
    Genera una URL de entrega para un recurso `type="authenticated"`
    (comprobante/voucher subido por `subir_voucher_pago`/`subir_pdf_membresia`
    desde este fix en adelante).

    `folder`: la MISMA carpeta (`settings.cloudinary_carpeta_vouchers` /
    `..._comprobantes`) que se usó al subir. Cloudinary indexa un recurso
    subido con `folder=` + `public_id=` como `{folder}/{public_id}` -- NO
    como `public_id` solo -- así que sin esto se firma (correctamente) una
    URL para un recurso que Cloudinary nunca tuvo bajo ese nombre exacto:
    firma válida, 404 igual (bug real, issue #480 -- ningún test lo agarró
    porque los tests firman localmente sin tocar la cuenta real, y ese
    detalle de indexado es del vendor, no de este código).

    NO hace red: `cloudinary.utils.cloudinary_url` firma localmente con las
    credenciales ya cargadas por `_configurar_cliente()`, así que esto corre
    incluso si Cloudinary está caído o el circuito está abierto -- generar el
    link no es "subir", no hay nada que proteger acá.

    Se llama en cada lectura autorizada, nunca al momento de subir ni de
    persistir: si se guardara la URL firmada en la fila del pago, quedaría
    vencida (o eternamente vigente, ver abajo) esperando en la BD en vez de
    reflejar el momento real en que alguien autorizado la pidió.

    Vencimiento real (`duration`, vía `auth_token`) SOLO si
    `settings.cloudinary_auth_token_key` está configurada -- token-based
    authentication es una función que hay que habilitar en la cuenta de
    Cloudinary (Console > Settings > Security), no algo que este código
    pueda activar por su cuenta. Sin esa clave, la URL queda igual firmada
    con `sign_url=True` (nadie sin el `api_secret` puede construir un link
    que Cloudinary acepte) pero sin vencer -- cierra la enumeración pública,
    no la reutilización indefinida de un link ya firmado que se filtre.
    Ver docs/archive/fixes/16-voucher-no-enumerable.md para el residual documentado.
    """
    _configurar_cliente()

    opciones: dict = {
        "type": "authenticated",
        "resource_type": resource_type,
        "sign_url": True,
        "secure": True,
    }
    if formato:
        opciones["format"] = formato
    if settings.cloudinary_auth_token_key:
        opciones["auth_token"] = {
            "key": settings.cloudinary_auth_token_key,
            "duration": CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS,
        }

    id_completo = f"{folder}/{public_id}"
    url, _opciones_restantes = cloudinary.utils.cloudinary_url(id_completo, **opciones)
    return url


def resolver_url_entrega(
    valor_almacenado: Optional[str],
    resource_type: str,
    folder: str,
    formato: Optional[str] = None,
) -> Optional[str]:
    """
    Traduce lo persistido en `Pago.voucher_url` / `ComprobantePago.archivo_url`
    a una URL de entrega. Desde este fix se persiste el `public_id` (no la
    URL), así que el caso normal es firmar fresco con `generar_url_firmada`.
    `folder`: se reenvía tal cual a `generar_url_firmada` -- ver su docstring
    (issue #480). No aplica a las filas heredadas de abajo: esas ya son una
    URL completa y se devuelven sin tocar.

    Filas anteriores al fix guardaron el `secure_url` completo de un recurso
    `type="upload"` (público, enumerable -- exactamente el hallazgo que este
    módulo corrige). No hay forma de repararlas sin volver a subir el
    archivo bajo `type="authenticated"` con las credenciales reales de
    Cloudinary (ausentes en este entorno); se detectan por el ESQUEMA
    (`urlparse(...).scheme in ("http", "https")`, no un prefijo de string) y
    se devuelven sin cambios en vez de romperlas en silencio -- siguen
    siendo públicas, riesgo residual documentado en
    docs/archive/fixes/16-voucher-no-enumerable.md junto con la migración pendiente.
    `urlparse` normaliza el esquema a minúsculas, así que un valor heredado
    con `HTTPS://` en mayúsculas también se detecta como URL (diferencia
    deliberada frente a un `startswith` literal: en la práctica no ocurre,
    porque Cloudinary siempre emite el esquema en minúsculas, pero de
    ocurrir es preferible devolverlo tal cual a mandarlo a firmar como si
    fuera un `public_id`).
    """
    if not valor_almacenado:
        return None
    if urlparse(valor_almacenado).scheme in ("http", "https"):
        return valor_almacenado
    return generar_url_firmada(
        valor_almacenado, resource_type=resource_type, folder=folder, formato=formato,
    )


def resolver_url_foto_perfil(valor_almacenado: Optional[str]) -> Optional[str]:
    """
    `resolver_url_entrega` aplicado a `Persona.foto_url` (issue #553,
    Problema 2): fija `resource_type="image"` y la carpeta de fotos de
    perfil para que TODOS los puntos que serializan una foto (auth +
    personas) firmen contra el mismo recurso indexado
    (`{carpeta}/{public_id}`, issue #480). Las filas heredadas (URL pública
    completa) pasan sin tocar hasta que el operador corra
    `scripts/migrar_fotos_perfil_autenticadas.py`.
    """
    return resolver_url_entrega(
        valor_almacenado,
        resource_type="image",
        folder=settings.cloudinary_carpeta_fotos_perfil,
    )
