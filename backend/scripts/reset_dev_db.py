"""Reset destructivo de la base de datos de desarrollo.

Por qué existe: la DB de desarrollo (`cata_club-db-1`) quedó con un
`alembic_version` fantasma (`21d79a1b7d64`, una revisión que no existe en
ningún archivo de migración ni en ningún commit) mientras su posición real
era `9a8b7c6d5e4f`. `alembic upgrade head` no podía avanzar ni retroceder
desde ese estado inconsistente. Ver `backend/scripts/RUNBOOK_reset_db.md`
para el detalle completo del incidente y del procedimiento de recuperación.

Secuencia (ver D1 en el design de `backend-schema-recovery-and-api-repair`):
    1. `validar_reset_permitido(...)`: guard de dos capas (ver docstring).
    2. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` sobre
       `settings.database_url` (vía psycopg/SQLAlchemy).
    3. `alembic upgrade head` desde el esquema vacío.
    4. `scripts/seed_dev_base.py` (idempotente).

Uso:
    make db-reset
    uv run python scripts/reset_dev_db.py
    uv run python scripts/reset_dev_db.py --dry-run
    # Fuera de AMBIENTE=development (ej. un ambiente de staging local):
    uv run python scripts/reset_dev_db.py --forzado --confirmar-nombre=cataclub_db
"""
import argparse
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

_RAIZ_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_RAIZ_BACKEND))

from app.soporte_transversal.configuracion import settings  # noqa: E402


class ResetNoPermitidoError(RuntimeError):
    """Se lanza cuando el reset de la base de datos no está permitido."""


# Parámetros de query string que el dialecto psycopg/libpq usa para
# sobrescribir el destino real de la conexión, tomando precedencia sobre el
# host/base parseados del netloc de la URL. Si se permitiera cualquiera de
# estos, un `DATABASE_URL` con un netloc en la allow-list (ej. `localhost`)
# pero `?host=<host real>` (o `?hostaddr=` / `?dbname=`) conectaría de hecho
# a un destino distinto del validado — bypass total del guard. No existe un
# uso legítimo de estos parámetros en un reset de desarrollo, así que se
# rechazan de plano en vez de intentar normalizarlos.
_PARAMS_QUERY_STRING_PROHIBIDOS = {"host", "hostaddr", "dbname"}


def _validar_sin_overrides_de_destino(url) -> None:
    """Rechaza la URL si su query string trae `host`, `hostaddr` o
    `dbname`: esa es la clase completa de overrides que el driver psycopg
    antepone al host/base del netloc al construir los connect args reales
    (`dialect.create_connect_args`), y por lo tanto puede hacer que la
    conexión real no coincida con lo que valida este guard."""
    presentes = _PARAMS_QUERY_STRING_PROHIBIDOS & set(url.query.keys())
    if presentes:
        raise ResetNoPermitidoError(
            "DATABASE_URL trae parámetro(s) de query string "
            f"{sorted(presentes)} que sobrescriben el destino real de la "
            "conexión (host/base) por encima del netloc de la URL. Esta "
            "protección es incondicional: --forzado no puede saltarla. "
            "Un reset de desarrollo nunca necesita estos parámetros; "
            "quitalos de DATABASE_URL."
        )


def validar_reset_permitido(
    ambiente: str,
    forzado: bool,
    database_url: str,
    confirmar_nombre: str | None = None,
) -> None:
    """Guard de dos capas independientes para el reset destructivo.

    1. Allow-list de host, INCONDICIONAL: si el host resuelto desde
       `database_url` no está en `settings.reset_hosts_permitidos`, se
       rechaza sin importar `ambiente` ni `forzado`. Esta capa es la que
       impide que un `.env` con `AMBIENTE=development` pero `DATABASE_URL`
       apuntando a un Postgres compartido/staging destruya esa base.
       Como parte de esta misma capa incondicional, también se rechaza
       cualquier `database_url` cuyo query string incluya `host`,
       `hostaddr` o `dbname`: son parámetros que el driver psycopg usa para
       sobrescribir el destino real de la conexión por encima del netloc
       (ver `_validar_sin_overrides_de_destino`), y permitirlos anularía la
       allow-list de host validando un destino distinto del real.
    2. Si el host es válido y `ambiente == "development"`, se permite (flujo
       normal de desarrollo local). Si `ambiente` es distinto, `forzado` por
       sí solo NO alcanza: además se exige `confirmar_nombre` igual al
       nombre exacto de la base parseado de `database_url` (segundo factor
       tipeado, sin prompt interactivo, para que siga siendo unit-testable).
    """
    url = make_url(database_url)
    host = url.host or ""
    nombre_db = url.database or ""

    _validar_sin_overrides_de_destino(url)

    if host not in settings.reset_hosts_permitidos:
        raise ResetNoPermitidoError(
            f"Host '{host}' no está en la lista de hosts permitidos para "
            f"reset ({', '.join(settings.reset_hosts_permitidos)}). Esta "
            "protección es incondicional: --forzado no puede saltarla. Si "
            "el reset es intencional, agregá el host explícitamente vía "
            "la variable de entorno RESET_HOSTS_PERMITIDOS."
        )

    if ambiente == "development":
        return

    if not forzado:
        raise ResetNoPermitidoError(
            f"AMBIENTE='{ambiente}' no es 'development'. El reset se niega "
            "salvo que se pase --forzado junto con --confirmar-nombre "
            "igual al nombre exacto de la base de datos a destruir."
        )

    if confirmar_nombre != nombre_db:
        raise ResetNoPermitidoError(
            f"--forzado en un ambiente no-development requiere "
            f"--confirmar-nombre='{nombre_db}' (nombre exacto de la base a "
            "destruir) como segundo factor. No coincide."
        )


def _ejecutar_reset(database_url: str, dry_run: bool) -> None:
    url = make_url(database_url)
    # flush=True: sin esto, cuando stdout no es una TTY (ej. `docker exec`
    # sin -t, o CI) Python bufferea la salida por bloque y este print queda
    # atrapado detrás de la salida de los subprocess de alembic/seed más
    # abajo — el eco del destino aparecería DESPUÉS de la acción destructiva
    # en vez de antes, anulando su propósito de confirmación previa.
    print(f"Resetting host={url.host} db={url.database}", flush=True)

    if dry_run:
        print("--dry-run: no se ejecuta ninguna acción destructiva.")
        return

    engine = create_engine(database_url)
    try:
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
    finally:
        engine.dispose()

    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"], check=True, cwd=_RAIZ_BACKEND
    )
    subprocess.run(
        ["uv", "run", "python", "scripts/seed_dev_base.py"],
        check=True,
        cwd=_RAIZ_BACKEND,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reset destructivo de la base de datos de desarrollo "
        "(drop + recreate schema, alembic upgrade head, reseed)."
    )
    parser.add_argument(
        "--forzado",
        action="store_true",
        help="Permite el reset fuera de AMBIENTE=development. Requiere "
        "--confirmar-nombre.",
    )
    parser.add_argument(
        "--confirmar-nombre",
        default=None,
        help="Nombre exacto de la base a destruir (segundo factor, solo "
        "aplica junto con --forzado fuera de development).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resuelve y muestra el host/base de datos destino sin "
        "ejecutar ninguna acción destructiva.",
    )
    args = parser.parse_args()

    try:
        validar_reset_permitido(
            settings.ambiente,
            args.forzado,
            settings.database_url,
            args.confirmar_nombre,
        )
    except ResetNoPermitidoError as exc:
        print(f"Reset denegado: {exc}", file=sys.stderr)
        sys.exit(1)

    _ejecutar_reset(settings.database_url, args.dry_run)


if __name__ == "__main__":
    main()
