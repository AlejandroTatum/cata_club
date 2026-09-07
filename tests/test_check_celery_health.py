"""Focused contracts for check-celery-health.sh (issue #1061).

`docker-compose.yml` already declares a healthcheck for celery-worker
(`inspect ping -d`) and one for celery-beat (freshness of
`celerybeat-schedule`), and `scripts/deploy/lib/post-checks.sh:check_celery`
already reads them at deploy/rollback time (issue #791/#1064). What was
missing was something reading that SAME signal BETWEEN deployments: the
sidecar `autoheal` (issue #1091) restarts a container that stays
`unhealthy`, but nothing external noticed if it stayed stuck anyway.

This script reuses `check_celery` verbatim -- no new liveness signal, no new
alert provider, just a new caller for the one that already exists.
"""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = "scripts/ops/check-celery-health.sh"


def run_script(env: dict[str, str]):
    entorno = {**os.environ, **env}
    return subprocess.run(
        ["bash", str(ROOT / SCRIPT)],
        cwd=ROOT,
        env=entorno,
        capture_output=True,
        text=True,
    )


def _docker_stub(bin_dir: Path) -> None:
    """`docker` de mentira: responde `ps --format json` e `inspect ping`,
    que es todo lo que `check_celery` necesita. Mismo idioma `${VAR-default}`
    que `tests/test_release_controls.py`: el default solo aplica cuando la
    variable no está seteada, así que `CELERY_WORKER_STATE=""` (contenedor que
    nunca arrancó) no cae al default "running"."""
    stub = bin_dir / "docker"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        'case " $* " in\n'
        '  *" ps --format json "*)\n'
        '    if [ -n "${CELERY_WORKER_STATE-running}" ]; then\n'
        '      printf \'{"Service":"celery-worker","State":"%s","Health":"%s"}\\n\' '
        '"${CELERY_WORKER_STATE-running}" "${CELERY_WORKER_HEALTH-healthy}"\n'
        '    fi\n'
        '    if [ -n "${CELERY_BEAT_STATE-running}" ]; then\n'
        '      printf \'{"Service":"celery-beat","State":"%s","Health":"%s"}\\n\' '
        '"${CELERY_BEAT_STATE-running}" "${CELERY_BEAT_HEALTH-healthy}"\n'
        '    fi ;;\n'
        '  *"inspect ping"*) exit "${CELERY_PING_EXIT:-0}" ;;\n'
        "esac\n"
        "exit 0\n"
    )
    stub.chmod(0o755)


def _env(tmp_path: Path, **extra: str) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _docker_stub(bin_dir)
    env = {
        "STACK_DIR": str(tmp_path),
        # Poll al mínimo: el stub responde en el primer intento (o falla de
        # entrada), sin motivo para esperar el intervalo real de producción.
        "SERVICIO_HEALTH_MAX_INTENTOS": "1",
        "SERVICIO_HEALTH_INTERVALO_SEGUNDOS": "0",
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
    }
    env.update(extra)
    return env


def test_pasa_si_celery_worker_y_beat_estan_sanos(tmp_path):
    result = run_script(_env(tmp_path))

    assert result.returncode == 0, result.stdout + result.stderr


def test_falla_si_celery_worker_no_esta_saludable(tmp_path):
    result = run_script(_env(tmp_path, CELERY_WORKER_HEALTH="unhealthy"))

    assert result.returncode != 0
    assert "celery-worker" in result.stderr


def test_falla_si_celery_beat_no_esta_saludable(tmp_path):
    """El caso real del issue #1061: beat colgado, mtime de
    `celerybeat-schedule` congelado, healthcheck en `unhealthy` -- y sin
    esto, sin nada externo que se entere entre despliegues."""
    result = run_script(_env(tmp_path, CELERY_BEAT_HEALTH="unhealthy"))

    assert result.returncode != 0
    assert "celery-beat" in result.stderr


def test_falla_si_celery_worker_no_arranco(tmp_path):
    """Ausente (nunca se creó el contenedor) tiene que fallar igual que
    'unhealthy', no pasar de largo por falta de dato."""
    result = run_script(
        _env(tmp_path, CELERY_WORKER_STATE="", CELERY_WORKER_HEALTH="")
    )

    assert result.returncode != 0
    assert "celery-worker" in result.stderr


def test_falla_si_el_round_trip_de_celery_no_responde(tmp_path):
    """`Health` sano en Docker no alcanza: si el broker no responde al ping de
    control, el chequeo tiene que fallar igual."""
    result = run_script(_env(tmp_path, CELERY_PING_EXIT="1"))

    assert result.returncode != 0
    assert "celery" in result.stderr.lower()
