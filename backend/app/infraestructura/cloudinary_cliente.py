"""
Adaptador de persistencia de archivos: Cloudinary.

Encapsula el SDK `cloudinary` y `cloudinary.uploader` para que el resto del
código dependa de una interfaz propia (no del SDK directo). Esto facilita tests
(reemplazable por un double) y protege al dominio de detalles de vendor.

Recursos privados en Cloudinary:
    El comprobante PDF, el voucher (PDF o imagen) y la foto de perfil se suben
    SIEMPRE como `type="authenticated"` -- nunca públicos. Cloudinary trata
    los PDF como `resource_type="raw"` (los `image` son para formatos
    raster/vector procesables), y desde el issue #1072 las IMÁGENES privadas
    (voucher JPEG/PNG y foto de perfil) también van como `raw`, con la
    extensión DENTRO del `public_id` (`perfil_31.jpg`).

    El motivo no es el upload sino la ENTREGA: este tipo de recurso sale por
    el endpoint de descarga de la API (`_url_descarga_api`), que sí vence del
    lado del servidor, y no por la CDN de `res.cloudinary.com`. Ver
    `_url_descarga_api` para el porqué medido (la cuenta no resuelve imágenes
    `authenticated` en `/image/download`, y la CDN firmada sin
    `cloudinary_auth_token_key` no vence nunca). El PDF mantiene su
    `format="pdf"` al subir; las imágenes llevan la extensión en el
    `public_id` (`public_id_con_extension`) para que la entrega no necesite
    metadata de formato.
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
# instancia a nivel de módulo, compartida por TODAS las llamadas de red del
# módulo: las subidas, que pasan por `_subir()`, y `eliminar_logo_sponsor`,
# que llama al SDK por su cuenta (issue #838). Ver Decisión E del diseño:
# estado en memoria + reloj monotónico + lock, sin Redis compartido -- lo que
# sostiene esto sin estado compartido es que Uvicorn y el worker de Celery
# corren cada uno como un solo proceso (`--concurrency=1`, docker-compose.yml).
_circuito_cloudinary = CircuitoBreaker(
    nombre="cloudinary",
    umbral_fallos=CIRCUITO_CLOUDINARY_UMBRAL_FALLOS,
    cooldown_segundos=CIRCUITO_CLOUDINARY_COOLDOWN_SEGUNDOS,
)


# --- Extensión de las imágenes dentro del `public_id` (issue #1072) ---------
# Un recurso `raw` guarda la extensión DENTRO del `public_id` -- es la única
# metadata de formato que tiene, porque `raw` no lleva `format` propio (a
# diferencia de `image`). La extensión sale del tipo MIME ya validado por los
# servicios (allowlist + firma binaria), nunca del nombre de archivo que
# declara el cliente.
_EXTENSION_POR_TIPO_MIME_IMAGEN = {"image/jpeg": "jpg", "image/png": "png"}


def extension_de_imagen(content_type: Optional[str]) -> Optional[str]:
    """Extensión (sin punto) de un MIME de imagen soportado por la app
    (`image/jpeg` -> `jpg`), o `None` si el MIME no está en la allowlist."""
    return _EXTENSION_POR_TIPO_MIME_IMAGEN.get((content_type or "").strip().lower())


def public_id_con_extension(nombre_publico: str, content_type: str) -> str:
    """`nombre_publico` con la extensión que corresponde a `content_type`.

    Es el `public_id` REAL de un recurso `raw` (issue #1072): el que se sube
    y el que hay que persistir para poder firmar su entrega después. Es
    idempotente a propósito -- servicio y capa de subida la aplican los dos,
    y divergir daría una firma válida para un recurso que Cloudinary nunca
    tuvo bajo ese nombre exacto (misma clase de trampa que el `folder` del
    issue #480: 404 con firma correcta, sin ningún error del lado del
    backend).

    `ValueError` si el MIME no está en la allowlist: los servicios validan
    ANTES de llamar acá (misma convención que `subir_voucher_pago`).
    """
    extension = extension_de_imagen(content_type)
    if extension is None:
        raise ValueError(f"Tipo MIME no soportado para imagen: {content_type}")
    sufijo = f".{extension}"
    if nombre_publico.lower().endswith(sufijo):
        return nombre_publico
    return f"{nombre_publico}{sufijo}"


# Sufijos que deja `public_id_con_extension`. Se usan también para reconocer
# una fila PREVIA al issue #1072 (el asset viejo se subió como
# `image/authenticated` y su `public_id` no lleva extensión).
_EXTENSIONES_DE_IMAGEN = (".jpg", ".jpeg", ".png")


def tiene_extension_de_imagen(public_id: str) -> bool:
    """`True` si `public_id` ya lleva la extensión con la que se sube un
    recurso `raw` de imagen (issue #1072).

    Distingue las DOS formas que hoy conviven en la base: el asset nuevo
    (`perfil_31.jpg`, `raw/authenticated`, entregable por el endpoint que
    vence) del viejo (`perfil_31`, `image/authenticated`, entregable por la
    CDN firmada). Lo usan `resolver_url_entrega` para la transición y
    `scripts/migrar_imagenes_a_raw.py` para decidir qué filas le faltan.
    """
    return public_id.lower().endswith(_EXTENSIONES_DE_IMAGEN)


# Sufijos que identifican un PDF en la columna de formato persistida
# (`Pago.voucher_formato` guarda el MIME completo; `ComprobantePago.
# formato_archivo` guarda `"pdf"`). Es el único discriminador válido para los
# recursos `raw`: su `public_id` nunca lleva extensión (la agrega la entrega).
_FORMATOS_PDF = ("application/pdf", "pdf")


def es_pdf(formato: Optional[str]) -> bool:
    """`True` si el formato persistido describe un PDF.

    Los dos valores reales: `Pago.voucher_formato` guarda el MIME completo
    (`application/pdf`) y `ComprobantePago.formato_archivo` guarda `"pdf"`.
    Cualquier otra cosa (incluido vacío/NULL) NO se asume PDF: asumirlo
    mandaría a `raw` un asset `image/authenticated`, y ese borrado equivocado
    no falla -- Cloudinary responde `not found` y el archivo queda vivo.
    """
    return (formato or "").strip().lower() in _FORMATOS_PDF


def resource_type_de_destruccion(
    valor_almacenado: str, content_type: Optional[str] = None
) -> str:
    """`resource_type` con el que hay que DESTRUIR el recurso descrito por lo
    persistido (`Pago.voucher_url`, `Persona.foto_url`, `ComprobantePago.
    archivo_url`). Único lugar donde vive esta discriminación: la usan
    `eliminar_voucher_pago` (y por lo tanto el reemplazo) y
    `SupresionDatosServicio`, que antes la duplicaban -- y que al hacerlo
    borraban como `raw` un asset que en realidad era `image/authenticated`.

    Cloudinary NO falla al destruir un `public_id` inexistente: responde
    `not found` sin excepción. O sea que un `resource_type` equivocado no
    rompe nada visible -- simplemente deja el archivo (foto de una persona,
    voucher bancario) VIVO en el proveedor después de una baja o de una
    supresión de datos. Por eso la regla tiene que salir de la forma
    persistida y no de una suposición:

      - PDF (`content_type` con formato pdf) -> `raw`: nunca lleva extensión
        en el `public_id`, la agrega la entrega. Sigue igual que siempre.
      - imagen CON extensión en el `public_id` (`perfil_31.jpg`,
        `voucher-pago-...jpg`) -> `raw`: es el recurso post-#1072.
      - imagen SIN extensión (`perfil_31`, `voucher-pago-...-v1-<uuid>`) ->
        `image`: es una fila PREVIA al #1072, y su asset vive como
        `image/authenticated`. La migración las convierte, pero hasta que eso
        corra el borrado tiene que apuntar donde el archivo realmente está.
    """
    if es_pdf(content_type):
        return "raw"
    return "raw" if tiene_extension_de_imagen(valor_almacenado) else "image"


def _configurar_cliente() -> None:
    """Inicializa el cliente de Cloudinary con las credenciales del entorno.
    Idempotente: re-aplicar la config sobreescribe pero no corrompe el state."""
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,  # SIEMPRE HTTPS para las URLs públicas devueltas
    )


def _timeout_cloudinary() -> Timeout:
    """Cota de reloj de pared para CUALQUIER llamada de red al SDK.

    Es un `urllib3.util.Timeout` y no un float: un float se convierte en
    `Timeout(read=t, connect=t)` per-operación de socket, sin cota real
    (`urllib3/util/timeout.py:186`). Solo una instancia de `Timeout` respeta
    el `total=` (`connectionpool.py:351`). Nota: `total=` no cubre
    completamente la fase de ENVÍO del cuerpo del request -- un cuerpo que
    fluye sin nunca estancarse 3s queda sin cota en esa fase específica;
    documentado, no resuelto (ver diseño).

    Se construye en cada llamada (y no una sola vez a nivel de módulo) para
    que las constantes se lean en el momento de usarlas, no al importar.
    """
    return Timeout(
        connect=TIMEOUT_CLOUDINARY_CONEXION_SEGUNDOS,
        read=TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
        total=TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
    )


def _subir(
    contenido: bytes,
    upload_kwargs: dict,
    descripcion: str,
    *,
    devolver_resultado_completo: bool = False,
) -> str | dict:
    """ÚNICO punto donde este módulo llama al SDK. Un solo intento: sin
    reintento. En la ruta de request quien reintenta es la persona (botón en
    el front); en la ruta de tarea reintenta Celery (autoretry_for + backoff,
    comprobante_tareas.py:42-45). Un tercer reintento acá multiplicaría los
    intentos contra el proveedor sin resolver nada.

    `devolver_resultado_completo`: por defecto devuelve solo `secure_url`
    (contrato histórico de PDF/voucher, que nunca usan otro campo del
    response del SDK). `subir_foto_perfil` lo pasa en `True` porque necesita
    además `version` (issue #662, ver su docstring) -- la validación de
    `secure_url` ausente corre igual en ambos modos.

    Antes de llamar al SDK se consulta el circuit breaker
    (`_circuito_cloudinary`, degradacion-controlada slice 2): si está
    ABIERTO, esta función NUNCA llama al SDK -- solo levanta
    `ServicioNoDisponible` de inmediato. Esto NO es un reintento ni lo
    contradice: el breaker decide si se hace el único intento permitido, no
    agrega un segundo intento sobre uno que ya falló.

    El `timeout` sale de `_timeout_cloudinary()`, compartido con el resto de
    las llamadas de red del módulo -- ver su docstring para el porqué de un
    `urllib3.util.Timeout` y no un float.
    """
    if not _circuito_cloudinary.permitir():
        raise ServicioNoDisponible(
            _MENSAJE_SUBIDA_NO_DISPONIBLE,
            detalle_tecnico=f"Cloudinary no disponible (circuito abierto): {descripcion}",
            seguro_mostrar=True,
        )

    timeout = _timeout_cloudinary()

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

    if devolver_resultado_completo:
        return resultado
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

        Issue #1327: si Cloudinary responde `existing: true` (el `public_id`
        YA tenía un recurso antes de esta subida), queda un WARNING en el log
        con el `public_id` -- la subida sigue sin fallar (el caso normal es
        el propio pago reintentando su `public_id` determinístico), pero una
        colisión con el recurso de OTRO pago queda visible para auditar en
        vez de reemplazarse en silencio.
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

    resultado = _subir(
        contenido_pdf, upload_kwargs, f"PDF de membresía (public_id={nombre_publico})",
        devolver_resultado_completo=True,
    )

    if resultado.get("existing"):
        logger.warning(
            "Cloudinary reporta `existing=true` al subir el PDF de membresía "
            "(public_id=%s): el public_id ya tenía un recurso antes de esta "
            "subida.", nombre_publico,
        )

    return resultado["secure_url"]


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

    Mapeo por tipo MIME (issue #1072):
      - application/pdf -> resource_type="raw", format="pdf" (la extensión la
        agrega la entrega, ver `_url_descarga_api`).
      - image/jpeg | image/png -> resource_type="raw" con la extensión DENTRO
        del `public_id` (`voucher-pago-...jpg`): la entrega de la imagen
        también sale por el endpoint de descarga, con vencimiento real del
        lado del servidor, así que el recurso necesita llevar la extensión en
        su nombre (`public_id_con_extension`).

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
        caller debe persistir el `public_id` REAL -- para las imágenes,
        `public_id_con_extension(nombre_publico, content_type)`, no
        `nombre_publico` -- y pedir la URL de entrega a `generar_url_firmada`
        en cada lectura autorizada.
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
            "overwrite": False,
            "invalidate": True,
            "format": "pdf",
        }
    elif content_type in ("image/jpeg", "image/png"):
        # resource_type="raw" (issue #1072): la imagen privada se entrega por
        # el endpoint de descarga, que NO resuelve `image/authenticated` y sí
        # vence; eso obliga a que la extensión viaje en el `public_id`
        # (ver `_url_descarga_api`). No se pasa `format`: en `raw` la
        # extensión ES el formato, y mandarla en los dos lados duplicaría la
        # misma intención.
        upload_kwargs = {
            "resource_type": "raw",
            "type": "authenticated",
            "public_id": public_id_con_extension(nombre_publico, content_type),
            "folder": settings.cloudinary_carpeta_vouchers,
            "overwrite": False,
            "invalidate": True,
        }
    else:
        raise ValueError(f"Tipo MIME no soportado para voucher: {content_type}")

    return _subir(
        contenido, upload_kwargs,
        f"voucher de pago (pago_id={pago_id}, public_id={nombre_publico})",
    )


def eliminar_voucher_pago(nombre_publico: str, content_type: Optional[str]) -> None:
    """Best-effort deletion of a committed replacement's former voucher.

    El `resource_type` sale de `resource_type_de_destruccion(nombre_publico,
    content_type)`: un voucher reemplazado puede ser un PDF (`raw`), una
    imagen ya migrada (`raw`) o una imagen PREVIA al issue #1072
    (`image/authenticated`). Mandar todo a `raw` no rompía nada visible
    -- Cloudinary responde `not found` sin excepción -- pero dejaba el
    comprobante bancario viejo, con datos del socio, vivo en el proveedor.

    `content_type` es el formato persistido (`Pago.voucher_formato`, MIME
    completo) y viaja además a la descripción del log. Puede venir NULL o
    atípico (filas viejas que nunca pasaron por el `content_type`
    validado): eso NO se asume PDF -- `es_pdf` devuelve `False` y la forma
    del `public_id` decide, que es la única marca que esas filas sí tienen.
    Asumir PDF mandaría a `raw` un asset `image/authenticated` y el borrado
    sería un no-op silencioso.
    """
    eliminar_logo_sponsor(
        nombre_publico,
        carpeta=settings.cloudinary_carpeta_vouchers,
        resource_type=resource_type_de_destruccion(nombre_publico, content_type),
        tipo="authenticated",
        descripcion=f"voucher ({content_type})",
    )


def subir_foto_perfil(
    contenido: bytes,
    nombre_publico: str,
    content_type: str,
    persona_id: int,
) -> int:
    """
    Sube la foto de perfil self-service de una Persona (Issue: foto de
    perfil propia). Mismo criterio de validación/subida que
    `subir_voucher_pago`, restringido a imágenes.

    Mapeo por tipo MIME: solo image/jpeg | image/png -> resource_type="raw"
    con la extensión DENTRO del `public_id` (`perfil_31.jpg`), mismo criterio
    y mismo motivo que el voucher en imagen (issue #1072): la entrega va por
    el endpoint de descarga, que vence, y no resuelve imágenes
    `image/authenticated` (ver `_url_descarga_api`).

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
        El `version` (entero) que Cloudinary asigna a ESTA subida -- no la
        URL del SDK (nunca fue una URL de entrega válida, ver el docstring
        de `subir_pdf_membresia`). El caller debe persistir
        `componer_valor_foto_perfil(public_id_con_extension(nombre_publico,
        content_type), version)` -- no `nombre_publico` solo: el `public_id`
        real de un recurso `raw` lleva la extensión -- y resolver la URL de
        entrega con `resolver_url_foto_perfil` en cada lectura autorizada.

        Issue #662: como `public_id` es determinístico y `overwrite=True`, la
        URL de entrega no puede quedar byte-idéntica entre dos subidas para
        la misma persona o el navegador sigue sirviendo la imagen cacheada de
        la carga anterior. Desde el issue #1072 eso lo garantiza el endpoint
        de descarga solo (firma un `timestamp`/`expires_at` nuevo en cada
        llamada, con resolución de un segundo); `version` se sigue
        persistiendo compuesto por continuidad con las filas ya escritas, no
        porque la entrega lo use.
    """
    _configurar_cliente()

    if not contenido:
        raise ValueError("El contenido de la foto está vacío; no se puede subir.")

    if content_type not in ("image/jpeg", "image/png"):
        raise ValueError(f"Tipo MIME no soportado para foto de perfil: {content_type}")

    upload_kwargs = {
        "resource_type": "raw",
        "type": "authenticated",
        "public_id": public_id_con_extension(nombre_publico, content_type),
        "folder": settings.cloudinary_carpeta_fotos_perfil,
        "overwrite": True,
        "invalidate": True,
    }

    resultado = _subir(
        contenido, upload_kwargs,
        f"foto de perfil (persona_id={persona_id}, public_id={nombre_publico})",
        devolver_resultado_completo=True,
    )

    version = resultado.get("version")
    if not isinstance(version, int):
        # Defensive, igual criterio que `secure_url` ausente en `_subir`:
        # Cloudinary siempre devuelve `version` en un upload exitoso, así que
        # su ausencia es una anomalía del vendor, no del caller.
        raise ServicioNoDisponible(
            _MENSAJE_SUBIDA_NO_DISPONIBLE,
            detalle_tecnico=(
                f"Cloudinary no retornó `version` (foto de perfil, "
                f"public_id={nombre_publico})"
            ),
            seguro_mostrar=True,
        )
    return version


def limpiar_foto_perfil_huerfana(valor_anterior: Optional[str], public_id_nuevo: str) -> None:
    """Best-effort deletion of a profile photo orphaned by a replacement.

    Issue #1072 (R3-001): el `public_id` de una foto de perfil ahora depende
    del formato subido (`perfil_N.jpg` vs `perfil_N.png`), así que
    `overwrite=True` ya NO garantiza un solo asset vivo -- reemplazar un jpg
    por un png (o reemplazar una fila previa a la migración, sin extensión)
    sube un recurso NUEVO y abandona el anterior sin destruirlo ni
    reportarlo: la foto vieja de una persona, menor incluido, sobrevive al
    reemplazo. `valor_anterior` es el `Persona.foto_url` de ANTES de
    persistir la subida (compuesto `public_id|version` o legado sin
    separador); se descarta si es una URL pública heredada (issue #553, sin
    `public_id` que destruir) o si coincide con `public_id_nuevo` (mismo
    formato, Cloudinary ya sobrescribió el mismo recurso). Mismo criterio de
    `resource_type_de_destruccion` que `eliminar_voucher_pago`: con
    extensión es el `raw` nuevo, sin extensión es el `image/authenticated`
    previo a `scripts/migrar_imagenes_a_raw.py`.

    Llaman acá `AuthServicio.actualizar_foto_perfil` y
    `PersonaServicio.actualizar_foto` para no divergir entre el self-service
    y la subida por un tercero autorizado.
    """
    if not valor_anterior:
        return
    public_id_anterior, _version = _descomponer_valor_foto_perfil(valor_anterior)
    if public_id_anterior.startswith("http") or public_id_anterior == public_id_nuevo:
        return
    try:
        eliminar_logo_sponsor(
            public_id_anterior,
            carpeta=settings.cloudinary_carpeta_fotos_perfil,
            resource_type=resource_type_de_destruccion(public_id_anterior),
            tipo="authenticated",
            descripcion="foto de perfil",
        )
    except Exception:
        logger.warning(
            "No se pudo limpiar una foto de perfil huérfana (public_id=%s)",
            public_id_anterior,
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


def _destruir_en_cloudinary(
    nombre_publico: str,
    *,
    carpeta: str,
    resource_type: str,
    tipo: str,
    descripcion: str,
    mensaje_no_disponible: str,
) -> None:
    """Core compartido de borrado en Cloudinary: circuito + timeout + redaccion
    de credenciales (issue #838). Sus unicos callers son
    `eliminar_logo_sponsor` y `eliminar_recurso_privado` (supresion de datos,
    issue #1062); el mensaje de cara al usuario lo elige cada uno.

    Nunca reintenta: la politica del modulo es un solo intento (ver
    `_subir`). Ante un fallo el circuito se alimenta y la excepcion escala --
    en el flujo de supresion el servicio la convierte en aborto de la
    ejecucion, nunca en un pasa-silencioso (D5)."""
    _configurar_cliente()

    if not _circuito_cloudinary.permitir():
        raise ServicioNoDisponible(
            mensaje_no_disponible,
            detalle_tecnico=(
                "Cloudinary no disponible (circuito abierto): eliminar "
                f"{descripcion} {nombre_publico}"
            ),
            seguro_mostrar=True,
        )

    try:
        cloudinary.uploader.destroy(
            f"{carpeta}/{nombre_publico}", resource_type=resource_type, type=tipo,
            invalidate=True, timeout=_timeout_cloudinary(),
        )
    except Exception as exc:
        _circuito_cloudinary.registrar_fallo()
        detalle = _redactar_detalle_sensible(str(exc))
        # Se registra el string YA redactado y SIN `exc_info`, igual que
        # `_subir()` arriba. Un `logger.exception(...)` escribe el traceback
        # completo, cuya ultima linea es `Tipo: str(exc)` sin pasar por
        # `_redactar_detalle_sensible`: redactar solo `detalle_tecnico` no
        # sirve de nada si el traceback ya copio la credencial al log.
        logger.error("Fallo eliminando %s de Cloudinary: %s", descripcion, detalle)
        raise ServicioNoDisponible(
            mensaje_no_disponible,
            detalle_tecnico=f"Error eliminando {descripcion}: {detalle}",
            seguro_mostrar=True,
        ) from exc

    _circuito_cloudinary.registrar_exito()


_MENSAJE_BORRADO_NO_DISPONIBLE = (
    "No se pudo eliminar el logo del patrocinador. Intente nuevamente."
)


def eliminar_logo_sponsor(
    nombre_publico: str,
    *,
    carpeta: str = "cataclub/sponsors",
    resource_type: str = "image",
    tipo: str = "upload",
    descripcion: str = "logo de patrocinador",
) -> None:
    """Retira un logo público; la fila se borra solo si el proveedor responde.

    Única llamada de red del módulo que no pasa por `_subir()`, y por eso la
    única que se había quedado sin las dos protecciones que ya tenían las
    subidas (issue #838, punto 3):

      - `timeout=`: `destroy()` acepta el mismo kwarg que `upload()`. Sin él,
        un par TCP que no responde cuelga la llamada indefinidamente -- y
        como `eliminar_sponsor` corre sobre el event loop, cuelga el proceso.
      - `_circuito_cloudinary`: sin registrar sus fallos, un Cloudinary caído
        nunca abría el circuito por este camino y cada request lo seguía
        intentando. Con el circuito ABIERTO no se llama al SDK, igual que en
        `_subir()`.
    """
    _destruir_en_cloudinary(
        nombre_publico,
        carpeta=carpeta,
        resource_type=resource_type,
        tipo=tipo,
        descripcion=descripcion,
        mensaje_no_disponible=_MENSAJE_BORRADO_NO_DISPONIBLE,
    )


_MENSAJE_BORRADO_SUPRESION_NO_DISPONIBLE = (
    "No se pudo eliminar un archivo del almacenamiento externo. La supresion "
    "de datos no se ejecuto; reintente mas tarde."
)


def eliminar_recurso_privado(
    nombre_publico: str,
    *,
    carpeta: str,
    resource_type: str,
    tipo: str = "authenticated",
    descripcion: str = "recurso privado",
) -> None:
    """Destruye un recurso `type="authenticated"` del flujo de supresion de
    datos (issue #1062, D5): foto de perfil, voucher de transferencia o
    comprobante PDF oficial -- documentos que llevan identidad embebida.

    Mismas dos protecciones que toda llamada de red del modulo (issue #838):
    `timeout=` y `_circuito_cloudinary`; el cuerpo es
    `_destruir_en_cloudinary`, el mismo de `eliminar_logo_sponsor`, con el
    mensaje propio del flujo de supresion.

    Idempotente a nivel del SDK: destruir un public_id que ya no existe
    responde `not found` SIN excepcion, asi que reintentar una ejecucion
    abortada nunca la rompe por el lado de Cloudinary.
    """
    _destruir_en_cloudinary(
        nombre_publico,
        carpeta=carpeta,
        resource_type=resource_type,
        tipo=tipo,
        descripcion=descripcion,
        mensaje_no_disponible=_MENSAJE_BORRADO_SUPRESION_NO_DISPONIBLE,
    )


# --- Recursos privados: endpoint de descarga de la API, no la CDN ---------
def _url_descarga_api(id_completo: str, formato: Optional[str]) -> str:
    """
    URL de entrega para un recurso `type="authenticated"` con
    `resource_type="raw"` -- el comprobante/voucher PDF y, desde el issue
    #1072, también el voucher JPEG/PNG y la foto de perfil -- firmada contra
    el endpoint de descarga de la API (`api.cloudinary.com/v1_1/<cloud>/raw/
    download`) en vez de la CDN (`res.cloudinary.com`).

    Por qué NO la CDN, en dos partes:

      - PDF: esta cuenta deniega la entrega de CUALQUIER PDF por CDN. Una URL
        firmada de `raw/authenticated` responde `401` con `x-cld-error: deny
        or ACL failure` y `content-length: 0` -- y responden exactamente lo
        mismo un `raw/upload` PÚBLICO y un `image/authenticated` con `.pdf`,
        mientras que una imagen (PNG/JPEG) firmada por esta MISMA función
        responde `200` con sus bytes. O sea: no es la firma, ni la ACL del
        recurso, ni la carpeta (issue #480) -- es la entrega de PDF por CDN,
        apagada a nivel de cuenta (Console > Settings > Security), que este
        código no puede encender.
      - Imágenes privadas (issue #1072): la CDN firmada sí las servía, pero
        SIN vencimiento real -- `cloudinary_auth_token_key` es una función
        de cuenta que no se puede activar desde acá, y sin ella el link
        firmado vale para siempre si se filtra. Acá el vencimiento lo chequea
        Cloudinary del lado del servidor.

    El endpoint de descarga sirve el MISMO recurso `type="authenticated"` sin
    pasar por esas restricciones. Para un PDF: `200`, `content-type:
    application/pdf` y los bytes reales; para una imagen subida como `raw` con
    su extensión en el `public_id` (issue #1072): `200`, `content-type:
    image/jpeg`/`image/png` y los bytes reales -- verificado en vivo contra la
    cuenta, así que sirve tal cual en un `<img src>` (de ahí que la CSP
    necesite `https://api.cloudinary.com` en `img-src`). No manda
    `Content-Disposition` (el PDF se sigue previsualizando inline en el
    `<iframe>` de la pantalla de pagos, igual que antes) ni `X-Frame-Options`,
    y responde `Access-Control-Allow-Origin: *`.

    La contracara medida: `/image/download` NO resuelve un recurso
    `image/authenticated` (`404 Resource not found` con `type=authenticated`,
    `200` con `type=upload`). Por eso las imágenes privadas se suben como
    `raw` y no como `image`: el tipo de entrega que vence elige el tipo de
    recurso, no al revés.

    Dos diferencias con `cloudinary_url`, las dos a favor:

      - el vencimiento (`expires_at`) lo CHEQUEA Cloudinary del lado del
        servidor (`401 Stale request`), así que el recurso vence a los
        `CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS` SIN depender de
        `cloudinary_auth_token_key`. El residual "link firmado que no vence
        nunca" queda cerrado para todo recurso privado.
      - `timestamp`/`expires_at` se recalculan en cada llamada, así que la
        URL no queda fija: un voucher corregido (`overwrite=True` en
        `subir_voucher_pago`) o una foto reemplazada terminan sirviéndose
        frescos (esto es lo que el issue #662 perseguía con `version`).
        Límite real, medido: `timestamp` es un ENTERO de segundos, así que dos
        firmas dentro del MISMO segundo salen byte-idénticas. El cache del
        navegador queda acotado a ese segundo, no a los 900 s de vigencia (que
        es cuánto vale el link, no cuánto lo cachea el browser).

    `formato`: el `public_id` de un recurso `raw` INCLUYE la extensión.
    Para el PDF la extensión la agrega este código (Cloudinary lo indexa como
    `{folder}/{public_id}.pdf` porque `subir_pdf_membresia`/
    `subir_voucher_pago` suben con `format="pdf"`); para las imágenes ya viene
    dentro del `public_id` (`perfil_31.jpg`, `public_id_con_extension`) y por
    eso acá va vacío. Pedir el recurso sin su extensión devuelve `404
    Resource not found` (misma clase de trampa que el `folder` del issue #480:
    firma válida, recurso que Cloudinary nunca tuvo bajo ese nombre exacto).

    Igual que `cloudinary_url`, NO hace red: `private_download_url` firma
    localmente con las credenciales ya cargadas. La `api_key` viaja en el
    query string, que es como Cloudinary diseñó este endpoint -- es un
    identificador público (el mismo que llevan los widgets de subida sin
    firmar), no la credencial: sin `api_secret` nadie puede recalcular la
    `signature`, y una firma alterada responde `401 Invalid Signature`.
    """
    if formato:
        id_completo = f"{id_completo}.{formato}"
    return cloudinary.utils.private_download_url(
        id_completo,
        "",
        resource_type="raw",
        type="authenticated",
        expires_at=int(time.time()) + CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS,
    )


# --- URL de entrega firmada (hallazgo de privacidad "voucher no enumerable") -
def generar_url_firmada(
    public_id: str,
    resource_type: str,
    folder: str,
    formato: Optional[str] = None,
    version: Optional[int] = None,
) -> str:
    """
    Genera una URL de entrega para un recurso privado `type="authenticated"`
    (comprobante/voucher subido por `subir_voucher_pago`/`subir_pdf_membresia`
    y foto de perfil subida por `subir_foto_perfil`).

    `folder`: la MISMA carpeta (`settings.cloudinary_carpeta_vouchers` /
    `..._comprobantes` / `..._fotos_perfil`) que se usó al subir. Cloudinary
    indexa un recurso subido con `folder=` + `public_id=` como
    `{folder}/{public_id}` -- NO como `public_id` solo -- así que sin esto se
    firma (correctamente) una URL para un recurso que Cloudinary nunca tuvo
    bajo ese nombre exacto: firma válida, 404 igual (bug real, issue #480 --
    ningún test lo agarró porque los tests firman localmente sin tocar la
    cuenta real, y ese detalle de indexado es del vendor, no de este código).

    NO hace red: `cloudinary.utils.cloudinary_url` firma localmente con las
    credenciales ya cargadas por `_configurar_cliente()`, así que esto corre
    incluso si Cloudinary está caído o el circuito está abierto -- generar el
    link no es "subir", no hay nada que proteger acá.

    Se llama en cada lectura autorizada, nunca al momento de subir ni de
    persistir: si se guardara la URL firmada en la fila del pago, quedaría
    vencida (o eternamente vigente, ver abajo) esperando en la BD en vez de
    reflejar el momento real en que alguien autorizado la pidió.

    `resource_type`: los DOS tipos que existen acá son `raw` y `image`, y la
    elección decide por qué camino sale el recurso.

      - `raw`: el comprobante oficial, el voucher (PDF desde siempre; JPEG/PNG
        desde el issue #1072) y la foto de perfil. NO sale por la CDN: se
        entrega por el endpoint de descarga de la API, ver
        `_url_descarga_api`, con vencimiento real del lado del servidor. El
        `public_id` ya incluye su extensión (`.pdf` agregada por el parámetro
        `formato`, o `.jpg`/`.png` dentro del propio `public_id`).
      - `image`: la CDN de `res.cloudinary.com` con `sign_url=True`. Desde el
        issue #1072 NINGÚN camino de entrega de la app la elige para un
        recurso privado (es justamente el link que no vence); sigue existiendo
        porque es la firma genérica del módulo y es la que necesita un
        recurso `image/authenticated` viejo que todavía no pasó por
        `scripts/migrar_imagenes_a_raw.py` -- ahí la usa el script para
        descargar los bytes del asset original. Vencimiento real
        (`duration`, vía `auth_token`) SOLO si
        `settings.cloudinary_auth_token_key` está configurada -- token-based
        authentication es una función que hay que habilitar en la cuenta de
        Cloudinary (Console > Settings > Security), no algo que este código
        pueda activar por su cuenta. Sin esa clave, la URL queda igual firmada
        con `sign_url=True` (nadie sin el `api_secret` puede construir un link
        que Cloudinary acepte) pero sin vencer.
        Ver docs/archive/fixes/16-voucher-no-enumerable.md para el residual
        documentado.

    `version` (issue #662): opcional, solo aplica a la rama `image`.
    Cloudinary embebe `version` como `/v{version}/` en la URL firmada --
    pasarlo hace que la URL de entrega CAMBIE cuando el recurso subyacente
    cambia (`overwrite=True` con el mismo `public_id`, como en
    `subir_foto_perfil`), lo que a su vez invalida el cache del NAVEGADOR
    (distinto de `invalidate=True`, que solo purga la CDN de Cloudinary y
    nunca tocó el cache del cliente). En la rama `raw` el parámetro se ignora
    a propósito: el endpoint de descarga recalcula `timestamp`/`expires_at` en
    cada llamada, así que la URL ya no queda fija entre segundos distintos
    (issue #1072; es lo que #662 perseguía). Con resolución de un segundo, dos
    firmas dentro del mismo segundo sí coinciden.
    """
    _configurar_cliente()

    id_completo = f"{folder}/{public_id}"

    if resource_type == "raw":
        # `raw` es el camino de TODO recurso privado de la app desde el issue
        # #1072 (PDF e imágenes): la CDN no lo entrega / no lo vence. Ver
        # `_url_descarga_api`. `version` no aplica a este endpoint: la URL ya
        # cambia en cada llamada.
        return _url_descarga_api(id_completo, formato)

    opciones: dict = {
        "type": "authenticated",
        "resource_type": resource_type,
        "sign_url": True,
        "secure": True,
    }
    if formato:
        opciones["format"] = formato
    if version is not None:
        opciones["version"] = version
    if settings.cloudinary_auth_token_key:
        opciones["auth_token"] = {
            "key": settings.cloudinary_auth_token_key,
            "duration": CLOUDINARY_URL_FIRMADA_VIGENCIA_SEGUNDOS,
        }

    url, _opciones_restantes = cloudinary.utils.cloudinary_url(id_completo, **opciones)
    return url


def resolver_url_entrega(
    valor_almacenado: Optional[str],
    resource_type: str,
    folder: str,
    formato: Optional[str] = None,
    version: Optional[int] = None,
) -> Optional[str]:
    """
    Traduce lo persistido en `Pago.voucher_url` / `ComprobantePago.archivo_url`
    a una URL de entrega. Desde este fix se persiste el `public_id` (no la
    URL), así que el caso normal es firmar fresco con `generar_url_firmada`.
    `folder`: se reenvía tal cual a `generar_url_firmada` -- ver su docstring
    (issue #480). No aplica a las filas heredadas de abajo: esas ya son una
    URL completa y se devuelven sin tocar.

    `resource_type`: desde el issue #1072 los caminos de entrega de la app
    pasan `"raw"` para TODO recurso privado (PDF, voucher en imagen y foto de
    perfil), porque es el único que entrega el recurso con vencimiento real
    del lado del servidor. `"image"` sigue siendo válido (firma contra la CDN)
    y lo usa `scripts/migrar_imagenes_a_raw.py` para bajar el asset
    `image/authenticated` viejo; la clasificación por ESQUEMA de más abajo no
    cambia: una fila heredada es una URL y se devuelve tal cual, con cualquier
    `resource_type`.

    Transición (issue #1072): un `public_id` de imagen que TODAVÍA no lleva
    extensión es una fila previa a ese fix -- se firma contra la CDN
    (`image/authenticated`), igual que antes, en vez del endpoint de descarga
    que devolvería `404`. Ver el comentario del bloque de transición.

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
    if not (settings.cloudinary_cloud_name and settings.cloudinary_api_key and settings.cloudinary_api_secret):
        # Cloudinary es opcional por diseño (las subidas fallan a demanda). Sin
        # credenciales de firma no hay URL firmada que entregar: degradar a None
        # en vez de reventar la serialización -- el SDK lanzaría
        # `ValueError: Must supply api_secret` y tumba el login (`/auth/me`).
        return None
    # Transición del issue #1072, acá y no en `generar_url_firmada` porque es
    # una regla sobre lo PERSISTIDO, no sobre cómo firmar: un `public_id` de
    # imagen sin extensión es una fila PREVIA al fix -- el asset existe como
    # `image/authenticated` y el endpoint de descarga (que ahora se pide con
    # `raw`) no lo resuelve (`404 Resource not found`). Se la sigue sirviendo
    # por la CDN firmada, que es exactamente como se servía ayer, hasta que
    # `scripts/migrar_imagenes_a_raw.py` la convierta. Sin esto, cualquiera de
    # los dos órdenes de despliegue quebraría los archivos ya subidos: las
    # filas viejas dan 404 en cuanto sube el código nuevo.
    #
    # Residual, acotado a esas filas y por eso vale la pena: el link de la CDN
    # no vence (es el hallazgo que este fix cierra) -- se cierra del todo recién
    # cuando la migración corre. `formato` no vacío (el PDF) y los `public_id`
    # con extensión no entran acá.
    ruta = resource_type
    if resource_type == "raw" and not formato and not tiene_extension_de_imagen(valor_almacenado):
        ruta = "image"
    return generar_url_firmada(
        valor_almacenado, resource_type=ruta, folder=folder, formato=formato,
        version=version,
    )


# --- Cache-busting de la foto de perfil (issue #662) ------------------------
# `Persona.foto_url` sigue siendo una única columna String; para no agregar
# una migración de esquema por esto, el `version` de Cloudinary viaja
# COMPUESTO en el mismo string que ya persistía el `public_id`
# (`{public_id}{_SEPARADOR_VERSION}{version}`). `|` es seguro como separador
# porque `public_id` siempre lo genera este código (`perfil_{persona_id}`,
# nunca entrada de usuario) y una URL heredada nunca lo contiene.
#
# Desde el issue #1072 el `version` ya no cambia la URL de entrega (el
# endpoint de descarga firma un `expires_at` nuevo en cada llamada); se sigue
# escribiendo y descomponiendo para no cambiar el shape persistido que ya
# tienen las filas en producción.
_SEPARADOR_VERSION_FOTO_PERFIL = "|"


def componer_valor_foto_perfil(public_id: str, version: int) -> str:
    """Arma el valor que persiste `Persona.foto_url` a partir del `public_id`
    y el `version` que devuelve `subir_foto_perfil` en ESTA subida. Ver
    `resolver_url_foto_perfil` para el lado que lo descompone."""
    return f"{public_id}{_SEPARADOR_VERSION_FOTO_PERFIL}{version}"


def _descomponer_valor_foto_perfil(valor: str) -> tuple[str, Optional[int]]:
    """Separa `(public_id, version)` de un valor persistido en
    `Persona.foto_url`. Dos casos devuelven `version=None` (sin romperse):
    una URL pública heredada (issue #553, sin separador) y un `public_id`
    persistido ANTES de este fix (issue #662, tampoco tiene separador) --
    ambos siguen resolviendo, solo sin cache-busting hasta la próxima subida
    real por esta app."""
    valor = valor.strip()
    if _SEPARADOR_VERSION_FOTO_PERFIL not in valor:
        return valor, None
    public_id, _, version_str = valor.rpartition(_SEPARADOR_VERSION_FOTO_PERFIL)
    if not version_str.isdigit():
        # Separador presente pero sin version numérica válida detrás: no
        # debería ocurrir (solo este módulo escribe el valor compuesto), pero
        # tratar el string entero como public_id es más seguro que reventar
        # la serialización de un GET.
        return valor, None
    return public_id, int(version_str)


def resolver_url_foto_perfil(valor_almacenado: Optional[str]) -> Optional[str]:
    """
    `resolver_url_entrega` aplicado a `Persona.foto_url` (issue #553,
    Problema 2): fija `resource_type="raw"` y la carpeta de fotos de perfil
    para que TODOS los puntos que serializan una foto (auth + personas)
    firmen contra el mismo recurso indexado (`{carpeta}/{public_id}`, issue
    #480). Las filas heredadas (URL pública completa) pasan sin tocar hasta
    que el operador corra `scripts/migrar_fotos_perfil_autenticadas.py`.

    `resource_type="raw"` (issue #1072): la foto se sube como `raw` con la
    extensión dentro del `public_id` (`perfil_31.jpg`) porque el endpoint de
    descarga es el único que vence de verdad del lado del servidor -- la CDN
    firmada de `image/authenticated` servía la foto pero sin vencimiento
    (ver `_url_descarga_api`). Una fila subida antes de este fix todavía
    tiene el `public_id` SIN extensión bajo `image/authenticated`: esas filas
    las migra `scripts/migrar_imagenes_a_raw.py` (dry-run por defecto) y
    mientras tanto se siguen sirviendo por la CDN firmada -- la regla de
    transición de `resolver_url_entrega`, para que el orden entre desplegar y
    migrar no rompa ninguna foto. Las filas con URL pública completa (previas
    al issue #553) tampoco las toca esto: se devuelven tal cual.

    Issue #662: el valor persistido puede además llevar el `version` de
    Cloudinary compuesto (`componer_valor_foto_perfil`). Se descompone para
    quedarse con el `public_id` (que es lo que hay que firmar) pero NO se
    reenvía: la entrega de un `raw` ya se refresca con el `expires_at` que se
    firma en cada lectura, así que el `version` dejó de tener efecto en la URL.
    """
    if not valor_almacenado:
        return None
    public_id, _version = _descomponer_valor_foto_perfil(valor_almacenado)
    return resolver_url_entrega(
        public_id,
        resource_type="raw",
        folder=settings.cloudinary_carpeta_fotos_perfil,
    )
