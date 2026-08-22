"""Migración one-off de fotos de perfil a `type="authenticated"` (issue #553).

Las fotos de perfil subidas ANTES del fix son recursos `type="upload"`
públicos y enumerables: el `public_id` era predecible (`perfil_{persona_id}`
bajo `settings.cloudinary_carpeta_fotos_perfil`), así que cualquiera que
conociera (o adivinara) el id de una persona podía descargar su foto — la
misma clase de hallazgo que "voucher no enumerable". Desde el fix, las subidas
nuevas ya persisten el `public_id` en `Persona.foto_url` y se sirven con URL
firmada en cada lectura autorizada; las filas ANTERIORES siguen guardando la
`secure_url` pública completa y necesitan este script para dejar de exponerse.

Por qué "re-subir y no solo firmar": no existe forma de pasar un recurso
`type="upload"` (público) a `type="authenticated"` sin volver a subirlo.
Cloudinary puede descargar la URL pública original server-side (`fetch`), así
que el script NO necesita el binario local.

Secuencia por fila pendiente (idempotente y safe por defecto):
    1. Re-subir la URL pública como `type="authenticated"` con el MISMO
       `public_id` (`perfil_{persona_id}`) y carpeta, `overwrite=True`.
    2. Persistir `Persona.foto_url = "perfil_{persona_id}"` (patrón voucher).
    3. Solo si (1) y (2) salieron bien, destruir el recurso público original
       (`{carpeta}/{public_id}` bajo `type="upload"`).

Garantías:
    - Dry-run POR DEFECTO: sin `--ejecutar` no hay NINGUNA llamada a
      Cloudinary ni cambio en la base (misma convención que
      `scripts/reset_dev_db.py --dry-run`).
    - Idempotencia: una fila que ya persiste el `public_id` nunca se re-sube.
    - Un fallo en una foto no detiene el resto del lote.
    - Si la re-subida y la persistencia salen bien pero el destroy del recurso
      público falla, la fila queda migrada (ya se sirve firmada) y el residuo
      público se reporta aparte (`residuos_publicos`) para re-correr el script.

Uso:
    uv run python scripts/migrar_fotos_perfil_autenticadas.py            # dry-run
    uv run python scripts/migrar_fotos_perfil_autenticadas.py --ejecutar # real
"""
import argparse
import logging
import sys
from pathlib import Path
from urllib.parse import urlparse

import cloudinary
import cloudinary.uploader

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.dominio.modelos import Persona  # noqa: E402
from app.soporte_transversal.configuracion import settings  # noqa: E402


logger = logging.getLogger("cataclub.migrar_fotos_perfil")


def _es_url_publica(valor: str | None) -> bool:
    """Detecta una fila heredada: una `secure_url` completa (esquema http/https).

    Mismo criterio que `cloudinary_cliente.resolver_url_entrega`: el esquema
    (normalizado por `urlparse`) decide, no un prefijo de string. Un
    `public_id` como `perfil_7` no tiene esquema y por lo tanto NO es URL.
    """
    return urlparse(valor or "").scheme in ("http", "https")


def migrar_fotos(db_session, ejecutar: bool = False) -> dict:
    """Migra las fotos de perfil públicas heredadas a `type="authenticated"`.

    Recibe una `Session` de SQLAlchemy para que los tests la ejerciten sin
    subproceso ni I/O (mismo patrón que `scripts/inventario_anomalias_*.py`).
    Devuelve un resumen de conteos, nunca datos personales.
    """
    resumen = {
        "pendientes": 0,
        "migradas": 0,
        "ya_migradas": 0,
        "fallidas": 0,
        "residuos_publicos": 0,
    }

    personas = (
        db_session.query(Persona)
        .filter(Persona.foto_url.isnot(None))
        .order_by(Persona.id)
        .all()
    )

    pendientes: list[Persona] = []
    for persona in personas:
        valor = (persona.foto_url or "").strip()
        if not valor:
            # Sin foto: nada que migrar.
            continue
        if _es_url_publica(valor):
            pendientes.append(persona)
        else:
            # Ya persiste el `public_id` (o un valor no-URL): no se re-sube.
            resumen["ya_migradas"] += 1

    resumen["pendientes"] = len(pendientes)

    if not ejecutar:
        return resumen

    carpeta = settings.cloudinary_carpeta_fotos_perfil

    for persona in pendientes:
        public_id = f"perfil_{persona.id}"
        url_original = persona.foto_url

        # 1. Re-subida server-side de la URL pública original como recurso
        # autenticado con el MISMO public_id y carpeta (idempotente).
        try:
            cloudinary.uploader.upload(
                url_original,
                resource_type="image",
                type="authenticated",
                public_id=public_id,
                folder=carpeta,
                overwrite=True,
            )
        except Exception:
            logger.warning(
                "No se pudo migrar la foto de perfil (persona_id=%s); se "
                "conserva la URL pública para el próximo intento.",
                persona.id,
            )
            resumen["fallidas"] += 1
            continue

        # 2. Persistir el `public_id` ANTES de destruir el original: a partir
        # de acá la foto ya se sirve firmada, así que un fallo en el destroy
        # no deja la fila apuntando a un recurso que ya no existe.
        persona.foto_url = public_id
        db_session.commit()

        # 3. Destruir el recurso público original (indexado como
        # `{carpeta}/{public_id}` bajo `type="upload"`, issue #480).
        try:
            cloudinary.uploader.destroy(
                f"{carpeta}/{public_id}",
                resource_type="image",
                type="upload",
                invalidate=True,
            )
        except Exception:
            logger.warning(
                "Foto migrada pero no se pudo destruir el recurso público "
                "original (persona_id=%s); residuo para re-correr el script.",
                persona.id,
            )
            resumen["residuos_publicos"] += 1

        resumen["migradas"] += 1

    return resumen


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migra fotos de perfil públicas heredadas a "
        "type='authenticated' (issue #553). Dry-run por defecto."
    )
    parser.add_argument(
        "--ejecutar",
        action="store_true",
        help="Ejecuta la migración real (re-subida + destroy). Sin esta flag "
        "solo se reporta qué filas están pendientes.",
    )
    args = parser.parse_args()

    # El destino sale de `settings` (entorno), nunca de argv — mismo criterio
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
        resumen = migrar_fotos(db, ejecutar=args.ejecutar)
    finally:
        db.close()

    modo = "EJECUTADO" if args.ejecutar else "DRY-RUN (sin cambios)"
    print(f"[fotos-perfil] {modo}: pendientes={resumen['pendientes']} "
          f"migradas={resumen['migradas']} ya_migradas={resumen['ya_migradas']} "
          f"fallidas={resumen['fallidas']} residuos_publicos={resumen['residuos_publicos']}")


if __name__ == "__main__":
    main()
