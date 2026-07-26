"""Tests del entrypoint de arranque fail-fast del contenedor `backend`.

Root cause del incidente (ver `backend/scripts/RUNBOOK_reset_db.md`): el
`command` original de `docker-compose.yml` encadenaba
`uv run alembic upgrade head; ...` con `;`, no `&&`. En `sh`, `;` NO propaga
el código de salida del comando anterior — así que si la migración fallaba,
el contenedor arrancaba igual sobre un esquema desactualizado/inconsistente,
sirviendo tráfico en silencio.

`backend/scripts/entrypoint.sh` reemplaza ese `command` inline: usa
`set -eu`, así que un `alembic upgrade head` que falla aborta el script
ANTES de llegar a `uvicorn`. Estos tests stubean `uv` en el PATH (el
entrypoint invoca `uv run alembic/python/uvicorn`, no los binarios sueltos)
con un fake que deja "sentinel files" para poder aserter, sin proceso, qué
pasos realmente se ejecutaron.
"""
import os
import stat
import subprocess
from pathlib import Path

import pytest
import yaml

ENTRYPOINT = Path(__file__).resolve().parent.parent / "scripts" / "entrypoint.sh"
COMPOSE_FILE = Path(__file__).resolve().parent.parent.parent / "docker-compose.yml"

FAKE_UV = """#!/bin/sh
# Fake `uv` para tests de entrypoint.sh: no ejecuta nada real, solo deja un
# sentinel file por paso invocado y sale con el código configurado por env.
#
# Detecta el subcomando RECORRIENDO los argumentos en vez de leer una posición
# fija: `uv run` admite flags (`--frozen`, `--no-build`) entre `run` y el
# comando real, así que asumir `$2` ataría estos tests al orden de los flags
# y fallarían al agregar uno, sin que el comportamiento del entrypoint cambie.
for arg in "$@"; do
  case "$arg" in
    alembic)
      touch "$SENTINEL_DIR/alembic_ran"
      exit "${ALEMBIC_EXIT:-0}"
      ;;
    python)
      touch "$SENTINEL_DIR/seed_ran"
      exit "${SEED_EXIT:-0}"
      ;;
    uvicorn)
      touch "$SENTINEL_DIR/uvicorn_ran"
      exit 0
      ;;
  esac
done
"""


@pytest.fixture
def fake_path(tmp_path):
    """Crea un `uv` falso en un directorio que antepone al PATH real."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    uv_falso = bin_dir / "uv"
    uv_falso.write_text(FAKE_UV)
    uv_falso.chmod(uv_falso.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)

    sentinel_dir = tmp_path / "sentinels"
    sentinel_dir.mkdir()

    return bin_dir, sentinel_dir


def _correr_entrypoint(fake_path, ambiente="development", alembic_exit=0, seed_exit=0):
    bin_dir, sentinel_dir = fake_path
    env = dict(os.environ)
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    env["AMBIENTE"] = ambiente
    env["SENTINEL_DIR"] = str(sentinel_dir)
    env["ALEMBIC_EXIT"] = str(alembic_exit)
    env["SEED_EXIT"] = str(seed_exit)

    resultado = subprocess.run(
        ["sh", str(ENTRYPOINT)], env=env, capture_output=True, text=True, timeout=10
    )
    return resultado, sentinel_dir


def test_alembic_falla_uvicorn_nunca_se_invoca(fake_path):
    resultado, sentinel_dir = _correr_entrypoint(fake_path, alembic_exit=1)

    assert resultado.returncode != 0
    assert (sentinel_dir / "alembic_ran").exists()
    assert not (sentinel_dir / "uvicorn_ran").exists()


def test_alembic_ok_uvicorn_se_invoca(fake_path):
    resultado, sentinel_dir = _correr_entrypoint(fake_path, alembic_exit=0)

    assert resultado.returncode == 0
    assert (sentinel_dir / "alembic_ran").exists()
    assert (sentinel_dir / "uvicorn_ran").exists()


def test_ambiente_produccion_omite_seed_pero_arranca_uvicorn(fake_path):
    resultado, sentinel_dir = _correr_entrypoint(fake_path, ambiente="production")

    assert resultado.returncode == 0
    assert not (sentinel_dir / "seed_ran").exists()
    assert (sentinel_dir / "uvicorn_ran").exists()


def test_seed_falla_uvicorn_nunca_se_invoca(fake_path):
    resultado, sentinel_dir = _correr_entrypoint(
        fake_path, ambiente="development", seed_exit=1
    )

    assert resultado.returncode != 0
    assert (sentinel_dir / "seed_ran").exists()
    assert not (sentinel_dir / "uvicorn_ran").exists()


def test_cada_uv_run_del_entrypoint_fija_lock_y_prohibe_builds():
    """Guardia estructural: toda invocación `uv run` del entrypoint debe
    llevar `--frozen` y `--no-build`.

    `--frozen` impide resolver versiones fuera del lock en el arranque del
    contenedor, y `--no-build` impide ejecutar setup scripts de sdists. Sin
    estos flags, el arranque podría instalar y ejecutar código no fijado por
    `uv.lock`; SonarCloud lo marca como vulnerabilidad, y sin este test nada
    impide que alguien los quite al editar el script."""
    lineas_uv_run = [
        linea.strip()
        for linea in ENTRYPOINT.read_text().splitlines()
        if "uv run" in linea and not linea.strip().startswith("#")
    ]

    assert lineas_uv_run, "el entrypoint debería invocar `uv run` al menos una vez"
    for linea in lineas_uv_run:
        assert "--frozen" in linea, f"falta --frozen en: {linea}"
        assert "--no-build" in linea, f"falta --no-build en: {linea}"


def test_compose_backend_command_invoca_entrypoint_sin_alembic_inline():
    """Guardia estructural: el `command` del servicio `backend` en
    docker-compose.yml debe delegar a entrypoint.sh en vez de encadenar
    `alembic upgrade head` inline con `;` (root cause del incidente
    original: `;` no propaga el código de salida de alembic, a diferencia
    de `&&` o de un script con `set -e`)."""
    with open(COMPOSE_FILE) as f:
        compose = yaml.safe_load(f)

    command = compose["services"]["backend"]["command"]
    assert "entrypoint.sh" in command
    assert "alembic" not in command, (
        "la migración debe vivir en entrypoint.sh, no encadenada inline "
        "en el command de compose"
    )
