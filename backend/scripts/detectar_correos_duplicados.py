"""Gate de pre-deploy, de solo lectura, para correos duplicados por
capitalización en `usuario.correo` (issue #1016, ADR-4).

Se corre a mano ANTES de `alembic upgrade head`. La migración de unicidad
(`<rev>_unique_correo_lower.py`) repite esta MISMA consulta y se NIEGA a
aplicarse si encuentra alguna colisión, así que este script nunca es la
única red -- es la que da tiempo para reconciliar manualmente ANTES de que
el deploy aborte solo a mitad de camino.

Reusa `detectar_colisiones` de `scripts/auditar_colisiones_correo.py`
(issue #902): misma consulta, mismo criterio de "colisión", una sola
implementación. La diferencia es el código de salida -- esa auditoría
informa siempre con 0 (una colisión ahí es un resultado esperado a
revisar); este script existe para bloquear un pipeline, así que SALE CON
1 si encuentra algo.

Cero escrituras demostrado, no asumido: reusa `abrir_sesion_solo_lectura`
(modo `READ ONLY` real de Postgres) por el mismo motivo que la auditoría.

Uso:
    uv run python scripts/detectar_correos_duplicados.py
    # $? == 0  -> sin colisiones, el deploy puede seguir
    # $? != 0  -> hay colisiones, reconciliar antes de reintentar
"""
import sys
from pathlib import Path

from sqlalchemy import create_engine

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.soporte_transversal.configuracion import settings  # noqa: E402
from scripts.auditar_colisiones_correo import (  # noqa: E402
    detectar_colisiones,
    formatear_texto,
)
from scripts.sesion_solo_lectura import abrir_sesion_solo_lectura  # noqa: E402


def codigo_de_salida(resultado: dict) -> int:
    """Función pura, separada de la sesión/I-O real (misma separación que
    `remediar_cuenta`/`formatear` en `scripts/remediar_rol_multiple.py`):
    0 sin colisiones, 1 si hay al menos una."""
    return 1 if resultado["buckets_en_colision"] > 0 else 0


def main() -> int:
    # El destino sale de `settings.database_url` (entorno), nunca de argv --
    # mismo criterio que `scripts/auditar_colisiones_correo.py`.
    engine = create_engine(settings.database_url)
    try:
        sesion = abrir_sesion_solo_lectura(engine)
        try:
            resultado = detectar_colisiones(sesion)
        finally:
            sesion.close()
    finally:
        engine.dispose()

    print(formatear_texto(resultado))
    codigo = codigo_de_salida(resultado)
    if codigo != 0:
        print(
            "\nABORTAR el deploy: hay correos duplicados por capitalización "
            "en usuario.correo. La migración de unicidad (issue #1016) se "
            "niega a aplicarse sobre esta base -- reconciliar manualmente "
            "(decidir qué cuenta es la real) antes de reintentar. Ninguna "
            "cuenta se elige ni se fusiona automáticamente."
        )
    return codigo


if __name__ == "__main__":
    sys.exit(main())
