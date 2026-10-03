"""Contracts for the pre-deploy production `.env` validator (check-prod-env.sh).

The validator fails closed and must never echo a secret value, only variable
names. It is also wired into preflight-production.sh behind an explicit opt-in.
"""

import os
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = "scripts/ops/check-prod-env.sh"

JWT = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
PG_PASSWORD = "pg-Zk39xQ-real-password"

VALID = {
    "DOMINIO": "app.cataclub.com",
    "DOMINIO_INDEXABLE": "app.cataclub.com",
    "DOMINIO_ALIAS_WWW": "www.app.cataclub.com",
    "CORS_ORIGENES": "https://app.cataclub.com",
    "FRONTEND_URL": "https://app.cataclub.com",
    "JWT_SECRET_KEY": JWT,
    "POSTGRES_PASSWORD": PG_PASSWORD,
}


def write_env(path: Path, values: dict[str, str | None]) -> Path:
    path.write_text(
        "".join(f"{k}={v}\n" for k, v in values.items() if v is not None)
    )
    return path


def run_check(*args: str):
    return subprocess.run(
        ["bash", str(ROOT / SCRIPT), *args],
        cwd=ROOT,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
    )


def check_env(tmp_path: Path, **overrides: str | None):
    env_file = write_env(tmp_path / ".env", {**VALID, **overrides})
    return run_check("--env-file", str(env_file))


def test_valid_production_env_passes(tmp_path):
    result = check_env(tmp_path)
    assert result.returncode == 0, result.stderr
    assert "OK" in result.stdout


def test_missing_env_file_fails_closed(tmp_path):
    result = run_check("--env-file", str(tmp_path / "nope.env"))
    assert result.returncode != 0


@pytest.mark.parametrize("value", [None, "", "staging.cataclub.com", "otro.com"])
def test_dominio_indexable_must_equal_dominio(tmp_path, value):
    result = check_env(tmp_path, DOMINIO_INDEXABLE=value)
    assert result.returncode != 0
    assert "DOMINIO_INDEXABLE" in result.stderr


def test_dominio_must_not_be_staging(tmp_path):
    result = check_env(
        tmp_path,
        DOMINIO="staging.cataclub.com",
        DOMINIO_INDEXABLE="staging.cataclub.com",
        CORS_ORIGENES="https://staging.cataclub.com",
        FRONTEND_URL="https://staging.cataclub.com",
    )
    assert result.returncode != 0
    assert "DOMINIO" in result.stderr


def test_dominio_placeholder_is_rejected(tmp_path):
    result = check_env(tmp_path, DOMINIO="<dominio-real>", DOMINIO_INDEXABLE="<dominio-real>")
    assert result.returncode != 0


@pytest.mark.parametrize(
    "name,value",
    [
        ("CORS_ORIGENES", "https://staging.cataclub.com"),
        ("CORS_ORIGENES", "https://app.cataclub.com,https://staging.cataclub.com"),
        ("CORS_ORIGENES", "https://otro.com"),
        ("CORS_ORIGENES", "http://app.cataclub.com"),
        ("FRONTEND_URL", "https://staging.cataclub.com"),
        ("FRONTEND_URL", "http://app.cataclub.com"),
        ("FRONTEND_URL", None),
    ],
)
def test_cors_and_frontend_url_must_point_to_prod_domain(tmp_path, name, value):
    result = check_env(tmp_path, **{name: value})
    assert result.returncode != 0
    assert name in result.stderr


def test_cors_accepts_extra_non_staging_origin(tmp_path):
    result = check_env(
        tmp_path, CORS_ORIGENES="https://app.cataclub.com,https://www.cataclub.com"
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "name",
    [
        "CLOUDINARY_CARPETA_COMPROBANTES",
        "CLOUDINARY_CARPETA_VOUCHERS",
        "CLOUDINARY_CARPETA_FOTOS_PERFIL",
    ],
)
def test_cloudinary_folders_must_not_mention_staging(tmp_path, name):
    result = check_env(tmp_path, **{name: "cataclub-Staging/vouchers"})
    assert result.returncode != 0
    assert name in result.stderr


def test_cloudinary_folders_without_staging_pass(tmp_path):
    result = check_env(tmp_path, CLOUDINARY_CARPETA_VOUCHERS="cataclub/vouchers")
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "name,value",
    [
        ("JWT_SECRET_KEY", None),
        ("JWT_SECRET_KEY", ""),
        ("JWT_SECRET_KEY", "short"),
        ("JWT_SECRET_KEY", "<clave-de-64-caracteres-hex>"),
        ("JWT_SECRET_KEY", "CAMBIAR_EN_.env_POR_UNA_CLAVE_SEGURA"),
        ("JWT_SECRET_KEY", "x" * 20 + "genera-una-clave"),
        ("POSTGRES_PASSWORD", None),
        ("POSTGRES_PASSWORD", ""),
        ("POSTGRES_PASSWORD", "short"),
        ("POSTGRES_PASSWORD", "password"),
        ("POSTGRES_PASSWORD", "<password-fuerte-mayor-a-8-caracteres>"),
    ],
)
def test_weak_or_placeholder_secrets_are_rejected(tmp_path, name, value):
    result = check_env(tmp_path, **{name: value})
    assert result.returncode != 0
    assert name in result.stderr


def test_secret_values_are_never_printed(tmp_path):
    result = check_env(
        tmp_path, JWT_SECRET_KEY="SECRETO-J", POSTGRES_PASSWORD="SECRETO"
    )
    assert result.returncode != 0
    assert "SECRETO" not in result.stdout + result.stderr


def test_quoted_values_and_last_assignment_win(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "".join(f"{k}={v}\n" for k, v in VALID.items())
        + 'DOMINIO_INDEXABLE="staging.cataclub.com"\n'
        + 'DOMINIO_INDEXABLE="app.cataclub.com"\n'
    )
    result = run_check("--env-file", str(env_file))
    assert result.returncode == 0, result.stderr


def test_previous_env_with_same_secret_fails_without_leaking(tmp_path):
    previous = write_env(
        tmp_path / "previous.env",
        {"JWT_SECRET_KEY": JWT, "POSTGRES_PASSWORD": "old-staging-password"},
    )
    env_file = write_env(tmp_path / ".env", VALID)
    result = run_check("--env-file", str(env_file), "--previous-env", str(previous))
    assert result.returncode != 0
    assert "JWT_SECRET_KEY" in result.stderr
    assert "POSTGRES_PASSWORD" not in result.stderr
    assert JWT not in result.stdout + result.stderr


def test_previous_env_with_rotated_secrets_passes(tmp_path):
    previous = write_env(
        tmp_path / "previous.env",
        {"JWT_SECRET_KEY": "f" * 64, "POSTGRES_PASSWORD": "old-staging-password"},
    )
    env_file = write_env(tmp_path / ".env", VALID)
    result = run_check("--env-file", str(env_file), "--previous-env", str(previous))
    assert result.returncode == 0, result.stderr


def test_unreadable_previous_env_fails_closed(tmp_path):
    env_file = write_env(tmp_path / ".env", VALID)
    result = run_check(
        "--env-file", str(env_file), "--previous-env", str(tmp_path / "missing.env")
    )
    assert result.returncode != 0


def test_unknown_argument_is_a_usage_error():
    assert run_check("--bogus").returncode == 2


def test_preflight_runs_the_check_only_when_opted_in():
    preflight = (ROOT / "scripts/ops/preflight-production.sh").read_text()
    assert "check-prod-env.sh" in preflight
    assert "PREFLIGHT_REQUIRE_PRODUCTION_ENV" in preflight


@pytest.mark.parametrize("value", [None, "", "www.otro.com", "<alias-www>"])
def test_alias_www_must_be_www_of_dominio(tmp_path, value):
    result = check_env(tmp_path, DOMINIO_ALIAS_WWW=value)
    assert result.returncode != 0
    assert "DOMINIO_ALIAS_WWW" in result.stderr
