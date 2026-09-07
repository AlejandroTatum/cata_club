"""Focused contracts for the memory alarm (check-memory.sh, issue #1071).

Se encadena antes de `notify-heartbeat.sh` en el cron de las 07:00 (ver
`scripts/deploy/deploy.sh` y `docs/operations/monitoring.md`): con `&&`, no
`;`, para que un contenedor cerca de su `mem_limit` o un host con poca memoria
disponible corte el ping y la AUSENCIA de heartbeat sea la alerta -- el mismo
mecanismo que ya usa `check-backup-freshness.sh`.
"""

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = "scripts/ops/check-memory.sh"


def run_script(*args: str, env: dict[str, str] | None = None):
    entorno = {**os.environ, **(env or {})}
    return subprocess.run(
        ["bash", str(ROOT / SCRIPT), *args],
        cwd=ROOT,
        env=entorno,
        capture_output=True,
        text=True,
    )


def _stub_docker_stats(bin_dir: Path, lines: list[str]) -> Path:
    """`docker` de mentira: ignora los argumentos y siempre imprime `lines`.

    El único comando que el script corre es `docker stats --no-stream
    --format ...`, así que el stub no necesita despachar por subcomando.
    """
    bin_dir.mkdir(parents=True, exist_ok=True)
    stub = bin_dir / "docker"
    cuerpo = "\n".join(lines)
    stub.write_text(f"#!/usr/bin/env bash\nprintf '%s\\n' {_shquote(cuerpo)}\n")
    stub.chmod(0o755)
    return stub


def _shquote(texto: str) -> str:
    return "'" + texto.replace("'", "'\\''") + "'"


def _meminfo(tmp_path: Path, available_kb: int) -> Path:
    archivo = tmp_path / "meminfo"
    archivo.write_text(
        "MemTotal:        2000000 kB\n"
        f"MemAvailable:    {available_kb} kB\n"
    )
    return archivo


def _base_env(tmp_path: Path, bin_dir: Path, available_kb: int) -> dict[str, str]:
    return {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "MEMINFO_FILE": str(_meminfo(tmp_path, available_kb)),
    }


def test_pasa_con_contenedores_bajos_y_host_con_margen(tmp_path):
    bin_dir = tmp_path / "bin"
    _stub_docker_stats(
        bin_dir,
        [
            "cata-club-caddy-1\t16.23MiB / 96MiB\t16.91%",
            "cata-club-celery-beat-1\t124.6MiB / 224MiB\t55.62%",
        ],
    )

    result = run_script(env=_base_env(tmp_path, bin_dir, available_kb=890000))

    assert result.returncode == 0, result.stderr


def test_falla_cuando_el_host_baja_del_umbral_de_disponible(tmp_path):
    bin_dir = tmp_path / "bin"
    _stub_docker_stats(bin_dir, ["cata-club-db-1\t55.89MiB / 320MiB\t17.47%"])

    result = run_script(env=_base_env(tmp_path, bin_dir, available_kb=100000))

    assert result.returncode != 0
    assert "disponible" in result.stderr.lower()


def test_min_available_mb_es_configurable(tmp_path):
    bin_dir = tmp_path / "bin"
    _stub_docker_stats(bin_dir, ["cata-club-db-1\t55.89MiB / 320MiB\t17.47%"])

    # 400 MiB disponibles pasa con el default (256) pero no con un umbral más
    # exigente pedido explícitamente.
    result_default = run_script(env=_base_env(tmp_path, bin_dir, available_kb=400000))
    result_estricto = run_script(
        "--min-available-mb",
        "512",
        env=_base_env(tmp_path, bin_dir, available_kb=400000),
    )

    assert result_default.returncode == 0, result_default.stderr
    assert result_estricto.returncode != 0


def test_falla_cuando_un_contenedor_supera_90_por_ciento_de_su_limite(tmp_path):
    bin_dir = tmp_path / "bin"
    _stub_docker_stats(
        bin_dir,
        [
            "cata-club-celery-beat-1\t150MiB / 160MiB\t93.75%",
            "cata-club-caddy-1\t16MiB / 96MiB\t16.91%",
        ],
    )

    result = run_script(env=_base_env(tmp_path, bin_dir, available_kb=890000))

    assert result.returncode != 0
    assert "cata-club-celery-beat-1" in result.stderr
    assert "93.75" in result.stderr
    # El contenedor que no es un ofensor no debe aparecer como tal.
    assert "cata-club-caddy-1" not in result.stderr


def test_contenedor_sin_limite_se_ignora_y_no_es_un_error(tmp_path):
    """Docker reporta `MemPerc` como `--` cuando el contenedor no tiene
    `mem_limit`: no hay porcentaje que comparar contra el 90%, así que el
    chequeo lo salta en vez de fallar o alertar."""
    bin_dir = tmp_path / "bin"
    _stub_docker_stats(
        bin_dir,
        [
            "algun-contenedor-sin-limite\t900MiB / 1.9GiB\t--",
            "cata-club-caddy-1\t16MiB / 96MiB\t16.91%",
        ],
    )

    result = run_script(env=_base_env(tmp_path, bin_dir, available_kb=890000))

    assert result.returncode == 0, result.stderr


def test_argumento_desconocido_sale_con_error_de_uso(tmp_path):
    result = run_script("--flag-inexistente")

    assert result.returncode == 2


def test_min_available_mb_no_numerico_sale_con_error_de_uso(tmp_path):
    result = run_script("--min-available-mb", "no-es-un-numero")

    assert result.returncode == 2
