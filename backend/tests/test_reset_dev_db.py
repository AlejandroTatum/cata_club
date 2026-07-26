"""Tests del guard de reset de la base de datos de desarrollo.

Contexto del incidente que motiva este guard: la DB de desarrollo quedó con
un `alembic_version` fantasma (`21d79a1b7d64`, ausente de todo archivo de
migración y de todo commit) mientras su posición real era `9a8b7c6d5e4f`.
Ver `backend/scripts/RUNBOOK_reset_db.md` para el detalle completo.

El guard tiene dos capas independientes:
  1. Allow-list de host, INCONDICIONAL — `forzado=True` no la salta nunca.
  2. `ambiente != "development"` requiere `forzado=True` Y `confirmar_nombre`
     igual al nombre exacto de la base (segundo factor tipeado).
"""
import pytest

from scripts.reset_dev_db import ResetNoPermitidoError, validar_reset_permitido

URL_HOST_PERMITIDO = "postgresql+psycopg://usuario:password@localhost:5432/cataclub_db"
URL_HOST_DESCONOCIDO = "postgresql+psycopg://usuario:password@staging.ejemplo.com:5432/cataclub_db"


def test_host_desconocido_rechaza_incluso_con_forzado():
    """La allow-list de host es incondicional: ni `forzado=True` la salta."""
    with pytest.raises(ResetNoPermitidoError):
        validar_reset_permitido("production", True, URL_HOST_DESCONOCIDO, "cataclub_db")


def test_host_desconocido_rechaza_en_development():
    with pytest.raises(ResetNoPermitidoError):
        validar_reset_permitido("development", False, URL_HOST_DESCONOCIDO, None)


def test_host_permitido_en_development_pasa():
    validar_reset_permitido("development", False, URL_HOST_PERMITIDO, None)


def test_query_string_host_override_rechaza_aunque_netloc_este_permitido():
    """El dialecto psycopg honra `host=` en el query string y lo antepone
    al host del netloc al armar los connect args reales. Un `DATABASE_URL`
    con netloc `localhost` (permitido) pero `?host=<host real>` conectaría
    a ese host real mientras el guard valida `localhost` — bypass total de
    la allow-list. Debe rechazarse de forma incondicional."""
    url_con_override = (
        "postgresql+psycopg://usuario:password@localhost:5432/cataclub_db"
        "?host=prod-db.internal.example.com"
    )
    with pytest.raises(ResetNoPermitidoError):
        validar_reset_permitido("development", False, url_con_override, None)


def test_query_string_hostaddr_override_rechaza_aunque_netloc_este_permitido():
    """`hostaddr=` es la misma clase de override que `host=` (libpq la usa
    para resolver la conexión sin pasar por DNS) y debe rechazarse igual."""
    url_con_override = (
        "postgresql+psycopg://usuario:password@localhost:5432/cataclub_db"
        "?hostaddr=10.0.0.1"
    )
    with pytest.raises(ResetNoPermitidoError):
        validar_reset_permitido("development", False, url_con_override, None)


def test_query_string_dbname_override_rechaza_aunque_netloc_este_permitido():
    """`dbname=` en el query string sobrescribe la base de datos real a la
    que se conecta el driver, independientemente del path del netloc."""
    url_con_override = (
        "postgresql+psycopg://usuario:password@localhost:5432/cataclub_db"
        "?dbname=produccion"
    )
    with pytest.raises(ResetNoPermitidoError):
        validar_reset_permitido("development", False, url_con_override, None)


def test_query_string_override_no_bypasseable_con_forzado():
    """El rechazo de overrides de host/base vía query string es incondicional,
    igual que la allow-list de host: `--forzado` no lo salta."""
    url_con_override = (
        "postgresql+psycopg://usuario:password@localhost:5432/cataclub_db"
        "?host=prod-db.internal.example.com"
    )
    with pytest.raises(ResetNoPermitidoError):
        validar_reset_permitido("production", True, url_con_override, "cataclub_db")


def test_host_permitido_no_dev_sin_forzado_rechaza():
    with pytest.raises(ResetNoPermitidoError):
        validar_reset_permitido("staging", False, URL_HOST_PERMITIDO, None)


def test_host_permitido_no_dev_forzado_sin_confirmar_nombre_rechaza():
    with pytest.raises(ResetNoPermitidoError):
        validar_reset_permitido("staging", True, URL_HOST_PERMITIDO, None)


def test_host_permitido_no_dev_forzado_confirmar_nombre_incorrecto_rechaza():
    with pytest.raises(ResetNoPermitidoError):
        validar_reset_permitido("staging", True, URL_HOST_PERMITIDO, "nombre_incorrecto")


def test_host_permitido_no_dev_forzado_confirmar_nombre_correcto_pasa():
    validar_reset_permitido("staging", True, URL_HOST_PERMITIDO, "cataclub_db")


def test_reset_hosts_permitidos_incluye_localhost_ip_y_db():
    """Settings.reset_hosts_permitidos trae el default documentado en D1:
    localhost + 127.0.0.1 (uso local directo) + db (hostname real del
    servicio Postgres en docker-compose.yml)."""
    from app.soporte_transversal.configuracion import Settings

    config = Settings()
    assert config.reset_hosts_permitidos == ["localhost", "127.0.0.1", "db"]


def test_dry_run_no_ejecuta_ninguna_accion_destructiva(monkeypatch, capsys):
    """--dry-run resuelve y muestra el destino sin tocar la base de datos."""
    from scripts import reset_dev_db

    def _fallar_si_se_llama(*args, **kwargs):
        raise AssertionError("create_engine no debería llamarse en --dry-run")

    monkeypatch.setattr(reset_dev_db, "create_engine", _fallar_si_se_llama)

    reset_dev_db._ejecutar_reset(URL_HOST_PERMITIDO, dry_run=True)

    salida = capsys.readouterr().out
    assert "localhost" in salida
    assert "cataclub_db" in salida
