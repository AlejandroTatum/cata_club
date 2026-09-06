"""Auditoría de solo lectura de comprobantes legacy en Cloudinary (issue
#1072, fila A-7 de `production-readiness.md`, ya descrita en ese documento).

Qué es "legacy": `Pago.voucher_url` y `ComprobantePago.archivo_url` guardan
hoy el `public_id` de un recurso `type="authenticated"`, pese al nombre de
las columnas -- ese es el caso NORMAL desde el fix "voucher no enumerable".
Una fila anterior a ese fix guardó, en cambio, la `secure_url` COMPLETA de
un recurso `type="upload"` público y enumerable, y `resolver_url_entrega`
(`app/infraestructura/cloudinary_cliente.py:658-661`) la devuelve tal cual
en vez de intentar firmarla -- ese es el riesgo residual documentado, no un
bug de esta auditoría. La detección usa el MISMO criterio que esa función y
que `scripts/migrar_fotos_perfil_autenticadas.py._es_url_publica`: el
ESQUEMA de la URL (`urlparse(...).scheme in ("http", "https")`), nunca un
prefijo de string -- un `public_id` como `voucher_42` no tiene esquema.

Por qué NO es una consulta nueva dentro de `inventario_anomalias_pagos.py`:
aquel script mide anomalías de PLATA (cobertura, tarifa, meses) del dominio
de #400; este mide un residuo de ALMACENAMIENTO de Cloudinary, un dominio
distinto sin relación con el ciclo de pagos. El precedente que sí aplica es
`auditar_colisiones_correo.py` (#902): mismo tipo de auditoría de solo
lectura contra producción, incluso mismo módulo de vencimiento del
`Session` (`abrir_sesion_solo_lectura`).

Cero escrituras demostrado, no asumido: `abrir_sesion_solo_lectura` abre la
conexión en modo `READ ONLY` de Postgres, que rechaza cualquier escritura
con un error del propio servidor -- este script se corre contra
producción, y ni siquiera puede llamar a la API de Cloudinary (no importa
`cloudinary` ni sus credenciales).

Este script SOLO CUENTA. La migración real (re-subir cada fila legacy como
`type="authenticated"` y destruir el recurso público original, mismo patrón
que `migrar_fotos_perfil_autenticadas.py`) es un script aparte, deliberadamente
no escrito todavía: escribirla antes de conocer el número de filas legacy es
fabricar código que puede terminar siendo código muerto si el residual se
decide aceptar como riesgo documentado en vez de migrar.

Uso:
    uv run python scripts/auditar_comprobantes_legacy.py [--json]
"""
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.dominio.modelos import ComprobantePago, Pago  # noqa: E402
from app.soporte_transversal.configuracion import settings  # noqa: E402
from scripts.sesion_solo_lectura import abrir_sesion_solo_lectura  # noqa: E402


def _clasificar(valor: str | None) -> str:
    """Mismo criterio que `resolver_url_entrega`/`_es_url_publica`: el
    esquema decide, nunca un prefijo de string. Tres estados posibles:

    - `legacy`: URL completa (`http`/`https`) -- la fila que este audit
      cuenta, pública y enumerable.
    - `migrada`: valor presente sin esquema -- ya persiste un `public_id`.
    - `vacia`: `NULL` o cadena vacía -- sin archivo cargado."""
    valor = (valor or "").strip()
    if not valor:
        return "vacia"
    if urlparse(valor).scheme in ("http", "https"):
        return "legacy"
    return "migrada"


def _contar_por_columna(valores: list[str | None]) -> dict:
    conteo = {"legacy": 0, "migrada": 0, "vacia": 0}
    for valor in valores:
        conteo[_clasificar(valor)] += 1
    conteo["total"] = len(valores)
    return conteo


def detectar_voucher_url_legacy(session: Session) -> dict:
    """Cuenta `Pago.voucher_url` por estado. `no_autoflush` porque la
    sesión es ajena (ver docstring del módulo): un `session.query` con
    autoflush bajaría a la base cambios pendientes del llamador."""
    with session.no_autoflush:
        valores = [fila[0] for fila in session.query(Pago.voucher_url).all()]
    return _contar_por_columna(valores)


def detectar_archivo_url_legacy(session: Session) -> dict:
    """Cuenta `ComprobantePago.archivo_url` por estado. La columna no
    admite `NULL` en el esquema, pero se clasifica igual que
    `voucher_url` (una cadena vacía cae en `vacia`) para que el total de
    ambas columnas se lea con el mismo criterio."""
    with session.no_autoflush:
        valores = [fila[0] for fila in session.query(ComprobantePago.archivo_url).all()]
    return _contar_por_columna(valores)


def construir_auditoria(session: Session) -> dict:
    """Agregador: el reporte completo, una entrada por columna auditada."""
    return {
        "pago_voucher_url": detectar_voucher_url_legacy(session),
        "comprobante_archivo_url": detectar_archivo_url_legacy(session),
    }


def formatear_json(auditoria: dict) -> str:
    return json.dumps(auditoria, ensure_ascii=False, indent=2)


def formatear_texto(auditoria: dict) -> str:
    lineas = [
        "Auditoría de comprobantes legacy en Cloudinary (issue #1072)",
        "",
    ]
    etiquetas = {
        "pago_voucher_url": "Pago.voucher_url",
        "comprobante_archivo_url": "ComprobantePago.archivo_url",
    }
    for clave, etiqueta in etiquetas.items():
        c = auditoria[clave]
        lineas.append(
            f"{etiqueta}: total={c['total']} legacy={c['legacy']} "
            f"migrada={c['migrada']} vacia={c['vacia']}"
        )
    lineas += [
        "",
        "'legacy' es la fila A-7 de production-readiness.md: URL completa",
        "pública, servida sin firmar. Este script NO migra nada -- ver",
        "docstring del módulo para el paso siguiente.",
    ]
    return "\n".join(lineas)


def main() -> None:
    # Código de salida SIEMPRE 0: un residual encontrado es el resultado
    # esperado de una auditoría, no una falla de proceso.
    parser = argparse.ArgumentParser(
        description="Auditoría de solo lectura de comprobantes legacy en "
        "Cloudinary (voucher_url y archivo_url con URL completa en vez de "
        "public_id). No escribe nada; ver issue #1072."
    )
    parser.add_argument("--json", action="store_true", help="Salida en JSON.")
    args = parser.parse_args()

    # El destino sale de `settings.database_url` (entorno), nunca de argv.
    engine = create_engine(settings.database_url)
    try:
        sesion = abrir_sesion_solo_lectura(engine)
        try:
            auditoria = construir_auditoria(sesion)
        finally:
            sesion.close()
    finally:
        engine.dispose()

    print(formatear_json(auditoria) if args.json else formatear_texto(auditoria))


if __name__ == "__main__":
    main()
