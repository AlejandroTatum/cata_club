"""Migración one-off de imágenes privadas a `raw/authenticated` (issue #1072).

Las imágenes privadas (voucher de transferencia en JPEG/PNG y foto de perfil)
se subían como `image/authenticated` y se entregaban con una URL firmada de la
CDN. Esa URL cerraba la enumeración pública, pero NO vencía: el vencimiento
real de la CDN depende de `cloudinary_auth_token_key` (token-based
authentication), una función que hay que habilitar en la cuenta de Cloudinary
y que este código no puede activar por su cuenta.

Desde el fix, esas imágenes se suben como `resource_type="raw"` con la
extensión dentro del `public_id` (`perfil_31.jpg`) y se entregan por el
endpoint de descarga de la API, que SÍ vence del lado del servidor
(`expires_at`, `401 Stale request`) sin depender de ninguna función de cuenta.
Ver `cloudinary_cliente._url_descarga_api`.

Las filas escritas ANTES del fix siguen apuntando al recurso
`image/authenticated` sin extensión, así que su URL de entrega nueva (que pide
`raw` y con extensión) daría 404: este script las convierte.

Por qué "bajar y re-subir" y no solo firmar distinto: Cloudinary no permite
cambiar `resource_type` ni `type` de un recurso ya subido. El script firma una
URL de CDN del recurso viejo, baja los bytes y los re-sube bajo
`raw/authenticated` con el `public_id` + extensión.

Secuencia por fila pendiente (idempotente y safe por defecto):
    1. Firmar la URL de entrega del asset viejo (`image/authenticated`, CDN) y
       bajar los bytes. El `content-type` de la respuesta es la fuente de
       verdad del formato (la columna
       `Pago.voucher_formato` se usa solo como referencia, ver abajo).
    2. Validar los bytes con la MISMA firma binaria que valida la subida
       (`es_firma_valida`, `soporte_transversal/firma_archivos.py`): si lo que
       hay guardado no es una imagen válida, la fila falla y no se toca.
    3. Re-subir como `raw/authenticated` con `public_id + extensión`.
    4. Persistir el nuevo `public_id` en `Pago.voucher_url` /
       `Persona.foto_url`.
    5. Solo si (3) y (4) salieron bien, destruir el asset viejo
       (`image/authenticated`, `public_id` sin extensión).

Garantías:
    - Dry-run POR DEFECTO: sin `--ejecutar` no hay NINGUNA llamada a
      Cloudinary (ni de firma, ni de red, ni de subida), ni cambio en la base
      -- misma convención que `scripts/migrar_fotos_perfil_autenticadas.py` y
      `scripts/reset_dev_db.py --dry-run`.
    - Re-ejecutable: una fila cuyo `public_id` ya lleva extensión nunca se
      vuelve a procesar (idempotencia real, no "no falla si se repite").
    - Un fallo en una fila no detiene el resto del lote.
    - Si (3) y (4) salen bien pero el destroy del asset viejo falla, la fila
      queda migrada (ya se sirve por el endpoint que vence) y el residuo se
      reporta aparte (`residuos_antiguos`) para re-correr el script.
    - Las filas con URL pública completa (`type="upload"`, previas al issue
      #553) se cuentan aparte (`url_publicas_heredadas`) y NO se tocan: son
      otro hallazgo, con su propio script de origen.

Uso:
    uv run python scripts/migrar_imagenes_a_raw.py            # dry-run
    uv run python scripts/migrar_imagenes_a_raw.py --ejecutar # real
"""
import argparse
import logging
import sys
from pathlib import Path
from urllib.parse import urlparse

import cloudinary
import cloudinary.uploader
import httpx
from urllib3.util import Timeout

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.dominio.modelos import Pago, Persona  # noqa: E402
from app.infraestructura.cloudinary_cliente import (  # noqa: E402
    componer_valor_foto_perfil,
    generar_url_firmada,
    public_id_con_extension,
)
from app.soporte_transversal.configuracion import settings  # noqa: E402
from app.soporte_transversal.firma_archivos import es_firma_valida  # noqa: E402
from app.soporte_transversal.resiliencia import (  # noqa: E402
    TIMEOUT_CLOUDINARY_CONEXION_SEGUNDOS,
    TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
)


logger = logging.getLogger("cataclub.migrar_imagenes_a_raw")

MIMES_IMAGEN = ("image/jpeg", "image/png")
EXTENSIONES_IMAGEN = (".jpg", ".jpeg", ".png")
_SEPARADOR_VERSION_FOTO_PERFIL = "|"

# Un objetivo del lote: ("voucher"|"foto", fila ORM, public_id viejo).
Objetivo = tuple[str, object, str]


def _es_url_publica(valor: str | None) -> bool:
    """Detecta una fila heredada: una `secure_url` completa (esquema http/https).

    Mismo criterio que `cloudinary_cliente.resolver_url_entrega`: el esquema
    (normalizado por `urlparse`) decide, no un prefijo de string.
    """
    return urlparse(valor or "").scheme in ("http", "https")


def _tiene_extension_de_imagen(public_id: str) -> bool:
    """`True` si el `public_id` ya lleva extensión de imagen -- o sea, si el
    recurso ya es el `raw` con extensión que deja esta migración."""
    return public_id.lower().endswith(EXTENSIONES_IMAGEN)


def _separar_version(valor: str) -> str:
    """`public_id` de un valor de `Persona.foto_url`, quitando el `version`
    compuesto de la issue #662 (`perfil_31|1700000001`). `Persona.foto_url`
    persiste el `public_id`; el `version` viaja en el mismo string porque no
    hay columna propia para él (ver `componer_valor_foto_perfil`)."""
    valor = valor.strip()
    if _SEPARADOR_VERSION_FOTO_PERFIL not in valor:
        return valor
    public_id, _, version_str = valor.rpartition(_SEPARADOR_VERSION_FOTO_PERFIL)
    return public_id if version_str.isdigit() else valor


def _content_type_normalizado(valor: str | None) -> str | None:
    """`image/jpeg` a partir de un header `Content-Type` (`image/jpeg;
    charset=utf-8` -> `image/jpeg`), o `None` si no vino nada."""
    if not valor:
        return None
    return valor.split(";")[0].strip().lower() or None


def _timeout_red() -> Timeout:
    """Misma cota de reloj de pared que las llamadas del módulo de Cloudinary
    (ver `cloudinary_cliente._timeout_cloudinary`): un float suelto se aplica
    por operación de socket, sin cota total."""
    return Timeout(
        connect=TIMEOUT_CLOUDINARY_CONEXION_SEGUNDOS,
        read=TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
        total=TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
    )


def _recolectar_pendientes(db_session) -> tuple[list[Objetivo], dict]:
    """Clasifica las filas con voucher-imagen o foto de perfil.

    Solo LEE: en dry-run no se toca la base ni la red.
    """
    resumen = {
        "pendientes": 0,
        "migradas": 0,
        "ya_migradas": 0,
        "fallidas": 0,
        "residuos_antiguos": 0,
        "url_publicas_heredadas": 0,
    }
    pendientes: list[Objetivo] = []

    pagos = db_session.query(Pago).filter(Pago.voucher_url.isnot(None)).order_by(Pago.id).all()
    for pago in pagos:
        valor = (pago.voucher_url or "").strip()
        if not valor:
            continue
        if _es_url_publica(valor):
            # Recurso `type="upload"` público: otro hallazgo (issue #553 y su
            # script), fuera del alcance de esta migración.
            resumen["url_publicas_heredadas"] += 1
            continue
        # El PDF no cambia con este fix: ya se sube como `raw` y su entrega ya
        # vence. Solo las imágenes son objetivo.
        if (pago.voucher_formato or "").lower() not in MIMES_IMAGEN:
            resumen["ya_migradas"] += 1
            continue
        if _tiene_extension_de_imagen(valor):
            resumen["ya_migradas"] += 1
            continue
        pendientes.append(("voucher", pago, valor))

    personas = (
        db_session.query(Persona)
        .filter(Persona.foto_url.isnot(None))
        .order_by(Persona.id)
        .all()
    )
    for persona in personas:
        valor = (persona.foto_url or "").strip()
        if not valor:
            continue
        if _es_url_publica(valor):
            resumen["url_publicas_heredadas"] += 1
            continue
        public_id = _separar_version(valor)
        if _tiene_extension_de_imagen(public_id):
            resumen["ya_migradas"] += 1
            continue
        pendientes.append(("foto", persona, public_id))

    resumen["pendientes"] = len(pendientes)
    return pendientes, resumen


def _descargar_imagen(carpeta: str, public_id: str) -> tuple[str, bytes]:
    """Baja los bytes del asset viejo (`image/authenticated`) por la CDN.

    Devuelve `(content_type, bytes)`. El `content-type` de la RESPUESTA manda:
    es lo que Cloudinary tiene realmente guardado. `cloudinary_url` con
    `sign_url=True` firma localmente -- la única red de este paso es el GET.
    """
    url = generar_url_firmada(public_id, resource_type="image", folder=carpeta)
    respuesta = httpx.get(
        url,
        timeout=TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS,
        follow_redirects=True,
    )
    respuesta.raise_for_status()

    contenido = respuesta.content
    content_type = _content_type_normalizado(respuesta.headers.get("content-type"))
    if content_type not in MIMES_IMAGEN:
        raise ValueError(f"Tipo de contenido inesperado en el asset: {content_type}")
    if not es_firma_valida(contenido, content_type):
        # Misma validación que la subida (decisión de diseño 2.3): el
        # content-type del proveedor es tan declarativo como el del cliente.
        raise ValueError("La firma binaria del asset no coincide con su tipo")
    return content_type, contenido


def _persistir(fila, kind: str, nuevo_public_id: str, version) -> None:
    """Escribe el nuevo `public_id` en la columna correspondiente.

    Para la foto se conserva el shape compuesto (`public_id|version`) ya
    escrito en producción; si el proveedor no devolvió `version`, se guarda el
    `public_id` solo (también resuelve: `_descomponer_valor_foto_perfil` acepta
    ambos).
    """
    if kind == "voucher":
        fila.voucher_url = nuevo_public_id
    elif isinstance(version, int):
        fila.foto_url = componer_valor_foto_perfil(nuevo_public_id, version)
    else:
        fila.foto_url = nuevo_public_id


def migrar_imagenes(db_session, ejecutar: bool = False) -> dict:
    """Migra a `raw/authenticated` las imágenes privadas que quedaron en
    `image/authenticated`.

    Recibe una `Session` de SQLAlchemy para que los tests la ejerciten sin
    subproceso ni I/O (mismo patrón que `migrar_fotos_perfil_autenticadas.
    migrar_fotos`). Devuelve un resumen de conteos, nunca datos personales.
    """
    pendientes, resumen = _recolectar_pendientes(db_session)

    if not ejecutar:
        return resumen

    for kind, fila, public_id in pendientes:
        carpeta = (
            settings.cloudinary_carpeta_vouchers
            if kind == "voucher"
            else settings.cloudinary_carpeta_fotos_perfil
        )
        descripcion = f"voucher del pago {fila.id}" if kind == "voucher" else f"foto de la persona {fila.id}"

        # 1 y 2. Bajar los bytes del asset viejo y validarlos.
        try:
            content_type, contenido = _descargar_imagen(carpeta, public_id)
        except Exception as exc:
            logger.warning(
                "No se pudo bajar el %s (public_id=%s); se conserva el valor "
                "actual para el próximo intento: %s",
                descripcion, public_id, exc,
            )
            resumen["fallidas"] += 1
            continue

        nuevo_public_id = public_id_con_extension(public_id, content_type)

        # 3. Re-subida como raw/authenticated, con la extensión en el
        # `public_id`. `overwrite=True` (a diferencia de la subida de un
        # voucher nuevo) para que re-correr el script tras un fallo parcial
        # nunca choque contra un recurso que ya existe.
        try:
            resultado = cloudinary.uploader.upload(
                contenido,
                resource_type="raw",
                type="authenticated",
                public_id=nuevo_public_id,
                folder=carpeta,
                overwrite=True,
                invalidate=True,
                timeout=_timeout_red(),
            )
        except Exception as exc:
            logger.warning(
                "No se pudo re-subir el %s como raw; se conserva el valor "
                "actual para el próximo intento: %s",
                descripcion, exc,
            )
            resumen["fallidas"] += 1
            continue

        # 4. Persistir ANTES de destruir el viejo: a partir de acá la fila ya
        # se sirve por el endpoint que vence, así que un fallo en el destroy
        # no la deja apuntando a un recurso que ya no existe.
        try:
            _persistir(fila, kind, nuevo_public_id, resultado.get("version"))
            db_session.commit()
        except Exception:
            db_session.rollback()
            logger.warning(
                "No se pudo persistir la migración del %s; el recurso nuevo "
                "queda huérfano y la fila sin tocar.", descripcion,
            )
            resumen["fallidas"] += 1
            continue

        # 5. Destruir el asset viejo (`image/authenticated`, `public_id` sin
        # extensión).
        try:
            cloudinary.uploader.destroy(
                f"{carpeta}/{public_id}",
                resource_type="image",
                type="authenticated",
                invalidate=True,
                timeout=_timeout_red(),
            )
        except Exception:
            logger.warning(
                "%s migrado pero no se pudo destruir el asset viejo; residuo "
                "para re-correr el script (public_id=%s).", descripcion, public_id,
            )
            resumen["residuos_antiguos"] += 1

        resumen["migradas"] += 1

    return resumen


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migra imágenes privadas (voucher JPEG/PNG y foto de "
        "perfil) de image/authenticated a raw/authenticated, para que su "
        "entrega venza (issue #1072). Dry-run por defecto."
    )
    parser.add_argument(
        "--ejecutar",
        action="store_true",
        help="Ejecuta la migración real (descarga + re-subida + destroy). Sin "
        "esta flag solo se reporta qué filas están pendientes.",
    )
    args = parser.parse_args()

    # El destino sale de `settings` (entorno), nunca de argv -- mismo criterio
    # que los demás scripts one-off del backend.
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )

    from app.infraestructura.db import SessionLocal

    db = SessionLocal()
    try:
        resumen = migrar_imagenes(db, ejecutar=args.ejecutar)
    finally:
        db.close()

    modo = "EJECUTADO" if args.ejecutar else "DRY-RUN (sin cambios)"
    print(f"[imagenes-raw] {modo}: pendientes={resumen['pendientes']} "
          f"migradas={resumen['migradas']} ya_migradas={resumen['ya_migradas']} "
          f"fallidas={resumen['fallidas']} "
          f"residuos_antiguos={resumen['residuos_antiguos']} "
          f"url_publicas_heredadas={resumen['url_publicas_heredadas']}")


if __name__ == "__main__":
    main()
