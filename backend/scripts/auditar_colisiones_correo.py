"""Auditoría de solo lectura de colisiones de `usuario.correo` por
capitalización (issue #902, fase B de #827 -- la fase A, un índice
funcional no único, sigue ABIERTA y no entregó nada; este script no
depende de ella).

Cero escrituras demostrado, no asumido: `abrir_sesion_solo_lectura` abre
la conexión en modo `READ ONLY` de Postgres, que rechaza cualquier
escritura con un error del propio servidor.

Reporta solo conteos, ids y una huella HMAC-SHA256 no reversible por
bucket (sal aleatoria por corrida, nunca persistida) -- nunca el correo.
Diseño reversible de normalización y criterios de revisión humana en
`docs/operations/auditoria-colisiones-correo.md`; este script no aplica
ninguno.

Uso:
    uv run python scripts/auditar_colisiones_correo.py [--json]
"""
import argparse
import hashlib
import hmac
import json
import secrets
import sys
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.orm import Session

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.dominio.modelos import Usuario  # noqa: E402
from app.soporte_transversal.configuracion import settings  # noqa: E402
from scripts.sesion_solo_lectura import abrir_sesion_solo_lectura  # noqa: E402, F401 (re-exportada para tests)

LARGO_HUELLA = 12  # hex; 48 bits alcanzan para distinguir buckets en un reporte


def _huella_hmac(clave_normalizada: str, sal: bytes) -> str:
    """HMAC-SHA256 de `lower(correo)` con sal de un solo uso: un SHA-256
    liso sería enumerable por diccionario (ver docstring del módulo)."""
    return hmac.new(sal, clave_normalizada.encode("utf-8"), hashlib.sha256).hexdigest()[:LARGO_HUELLA]


def detectar_colisiones(session: Session) -> dict:
    """Agrupa `usuario` por `lower(correo)` en una única consulta agregada;
    reporta los buckets con más de una fila."""
    with session.no_autoflush:
        total_usuarios = session.execute(select(func.count(Usuario.id))).scalar_one()

        correo_normalizado = func.lower(Usuario.correo)
        consulta = (
            select(
                correo_normalizado.label("clave"),
                func.count(Usuario.id).label("cantidad"),
                func.array_agg(
                    aggregate_order_by(Usuario.id, Usuario.id.asc())
                ).label("ids"),
                func.array_agg(
                    aggregate_order_by(Usuario.activo, Usuario.id.asc())
                ).label("activos"),
            )
            .group_by(correo_normalizado)
            .having(func.count(Usuario.id) > 1)
            .order_by(func.min(Usuario.id))
        )
        filas = session.execute(consulta).all()

    sal = secrets.token_bytes(32)  # nueva en cada corrida, nunca persistida

    buckets = []
    usuarios_en_colision = 0
    for fila in filas:
        buckets.append({
            "huella": _huella_hmac(fila.clave, sal),
            "cantidad": fila.cantidad,
            "ids": list(fila.ids),
            "activos": list(fila.activos),
        })
        usuarios_en_colision += fila.cantidad

    return {
        "total_usuarios": total_usuarios,
        "buckets_en_colision": len(buckets),
        "usuarios_en_colision": usuarios_en_colision,
        "buckets": buckets,
    }


def formatear_json(resultado: dict) -> str:
    return json.dumps(resultado, ensure_ascii=False, indent=2)


def formatear_texto(resultado: dict) -> str:
    lineas = [
        "Auditoría de colisiones de correo por capitalización "
        "(issue #902, fase B de #827 -- la fase A sigue abierta)",
        "",
        f"Total de usuarios: {resultado['total_usuarios']}",
        f"Buckets en colisión: {resultado['buckets_en_colision']}",
        f"Usuarios en colisión: {resultado['usuarios_en_colision']}",
        "",
    ]
    lineas += [
        f"  huella={b['huella']} cantidad={b['cantidad']} ids={b['ids']} activos={b['activos']}"
        for b in resultado["buckets"]
    ]
    return "\n".join(lineas)


def main() -> None:
    # Código de salida SIEMPRE 0: una colisión es el resultado esperado.
    parser = argparse.ArgumentParser(
        description="Auditoría de solo lectura de colisiones de usuario.correo "
        "por capitalización. No escribe nada; ver issue #902."
    )
    parser.add_argument("--json", action="store_true", help="Salida en JSON.")
    args = parser.parse_args()

    # El destino sale de `settings.database_url` (entorno), nunca de argv.
    engine = create_engine(settings.database_url)
    try:
        sesion = abrir_sesion_solo_lectura(engine)
        try:
            resultado = detectar_colisiones(sesion)
        finally:
            sesion.close()
    finally:
        engine.dispose()

    print(formatear_json(resultado) if args.json else formatear_texto(resultado))


if __name__ == "__main__":
    main()
