"""Auditoría de solo lectura de colisiones de `usuario.correo` por
capitalización (issue #902, fase B de #827 -- la fase A, un índice
funcional no único, sigue ABIERTA y no entregó nada; este script no
depende de ella).

Cero escrituras demostrado, no asumido: `abrir_sesion_solo_lectura` abre
la conexión en modo `READ ONLY` de Postgres, que rechaza cualquier
escritura con un error del propio servidor.

Reporta solo conteos, ids, un booleano de alcanzabilidad por fila (ver
`detectar_colisiones`) y una huella HMAC-SHA256 no reversible por bucket
(sal aleatoria por corrida, nunca persistida) -- nunca el correo.
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
    """HMAC-SHA256 de `lower(btrim(correo))` con sal de un solo uso: un
    SHA-256 liso sería enumerable por diccionario (ver docstring del
    módulo)."""
    return hmac.new(sal, clave_normalizada.encode("utf-8"), hashlib.sha256).hexdigest()[:LARGO_HUELLA]


def detectar_colisiones(session: Session) -> dict:
    """Agrupa `usuario` por `lower(btrim(correo))` en una única consulta
    agregada; reporta los buckets con más de una fila.

    Misma expresión que `_CLAVE_CANONICA` en la migración
    `d1016emailunico`: si difiriera, este audit reportaría "sin
    colisiones" en una base con duplicados que solo difieren en espacios,
    y esa migración fallaría a mitad de transacción en el deploy que este
    script está pensado para prevenir.

    Esa clave de agrupación NO es la que resuelve una cuenta en runtime.
    `UsuarioFichaRepositorio.obtener_por_correo` compara
    `lower(correo) = lower(btrim(entrada))`: recorta la ENTRADA, no la
    columna. Una fila legada con espacios al inicio o al fin cae en el
    mismo bucket que su gemela sin espacios, pero ninguna de las cuatro
    rutas que resuelven una cuenta por correo (login, registro,
    recuperación y restablecimiento) puede alcanzarla. Por eso cada
    bucket reporta `alcanzables`, un booleano por fila en el mismo orden
    que `ids`: si quien reconcilia la colisión conserva la fila
    inalcanzable, esa fila ocupa el único lugar canónico, el audit pasa a
    reportar cero colisiones y el dueño de la cuenta no vuelve a
    autenticarse nunca. El booleano dice si el valor almacenado ya está
    en forma canónica para ese predicado; no revela el correo ni los
    espacios."""
    with session.no_autoflush:
        total_usuarios = session.execute(select(func.count(Usuario.id))).scalar_one()

        correo_normalizado = func.lower(func.btrim(Usuario.correo))
        # Predicado de runtime, no el de la migración: la fila es
        # alcanzable solo si `lower(correo)` ya coincide con la clave
        # canónica, es decir si no tiene espacios al inicio ni al fin.
        alcanzable_en_runtime = func.lower(Usuario.correo) == correo_normalizado
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
                func.array_agg(
                    aggregate_order_by(alcanzable_en_runtime, Usuario.id.asc())
                ).label("alcanzables"),
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
            "alcanzables": list(fila.alcanzables),
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
        "alcanzables[i]=False: la búsqueda de runtime nunca resuelve esa "
        "fila; conservarla deja la cuenta muerta.",
        "",
    ]
    lineas += [
        f"  huella={b['huella']} cantidad={b['cantidad']} ids={b['ids']} "
        f"activos={b['activos']} alcanzables={b['alcanzables']}"
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
