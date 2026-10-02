"""`scripts/metrics/host-snapshot.sh` (issue #1314): el JSON que escribe el cron
del host y que el colector del celery-worker lee por un bind mount de solo
lectura.

Se corre el script de verdad, con `docker`, `/proc` y `df` falsos (PATH y
variables de entorno), y el resultado se pasa por `leer_host` del colector: el
contrato entre los dos lados es el mismo archivo, así que se prueba junto.
"""
import json
import os
import stat
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.infraestructura import colector_metricas as cm

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "metrics" / "host-snapshot.sh"

PROC_STAT_PREV = "cpu  1000 0 500 8000 500 0 0 0 0 0\n"
PROC_STAT_NOW = "cpu  1300 0 600 8500 600 0 0 0 0 0\n"  # +400 ocupado de +1000 total... ver test
MEMINFO = (
    "MemTotal:        3993600 kB\nMemFree:          200000 kB\nMemAvailable:    1536000 kB\n"
    "SwapTotal:       1048576 kB\nSwapFree:         829440 kB\n"
)

DOCKER_FALSO = """#!/bin/sh
case "$1" in
  ps) printf 'aaa111\\tbackend\\nbbb222\\tdb\\nccc333\\tredis\\nddd444\\t\\neee555\\tnolimit\\n' ;;
  stats) printf 'aaa111\\t262.3MiB / 320MiB\\nbbb222\\t214MiB / 320MiB\\nccc333\\t22.5MiB / 64MiB\\nddd444\\t5MiB / 10MiB\\neee555\\t100MiB / 3.8GiB\\n' ;;
esac
"""

DF_FALSO = """#!/bin/sh
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/vda1 25000000 13500000 11500000 54%% /\\n'
"""


@pytest.fixture()
def entorno(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for nombre, cuerpo in (("docker", DOCKER_FALSO), ("df", DF_FALSO)):
        ruta = bin_dir / nombre
        ruta.write_text(cuerpo)
        ruta.chmod(ruta.stat().st_mode | stat.S_IEXEC)
    metricas = tmp_path / "metricas"
    metricas.mkdir()
    proc_stat = tmp_path / "stat"
    proc_stat.write_text(PROC_STAT_NOW)
    meminfo = tmp_path / "meminfo"
    meminfo.write_text(MEMINFO)
    (metricas / ".cpu-prev").write_text("10000 8500\n")  # total idle de la corrida anterior
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "METRICS_DIR": str(metricas),
        "PROC_STAT_FILE": str(proc_stat),
        "MEMINFO_FILE": str(meminfo),
        "CPU_SAMPLE_SECONDS": "0",
    }
    return env, metricas


def _correr(env):
    return subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=30)


def test_escribe_el_json_con_el_esquema_que_lee_el_colector(entorno):
    env, metricas = entorno

    resultado = _correr(env)

    assert resultado.returncode == 0, resultado.stderr
    ahora = datetime.now(timezone.utc)
    host = cm.leer_host(metricas / "host.json", ahora)
    assert host is not None
    assert host["ram_total_mb"] == 3900 and host["ram_usada_mb"] == 2400  # (3993600-1536000)/1024
    assert host["swap_total_mb"] == 1024 and host["swap_usada_mb"] == 214
    assert host["disco_pct"] == 54
    assert abs((ahora - host["actualizado_en"]).total_seconds()) < 30


def test_cpu_es_el_promedio_desde_la_corrida_anterior(entorno):
    env, metricas = entorno
    # previo: total 10000, idle 8500. ahora: total 1300+600+8500+600=11000, idle 9100.
    # delta total 1000, delta idle 600 -> 40 % ocupado.
    (metricas / ".cpu-prev").write_text("10000 8500\n")

    _correr(env)

    assert json.loads((metricas / "host.json").read_text())["cpu_pct"] == 40.0


def test_contenedores_por_servicio_compose_sin_ids_ni_los_que_no_tienen_limite(entorno):
    env, metricas = entorno

    _correr(env)

    contenedores = json.loads((metricas / "host.json").read_text())["contenedores"]
    assert contenedores == [
        {"nombre": "backend", "usado_mb": 262, "limite_mb": 320},
        {"nombre": "db", "usado_mb": 214, "limite_mb": 320},
        {"nombre": "redis", "usado_mb": 23, "limite_mb": 64},
    ]
    assert "aaa111" not in (metricas / "host.json").read_text()


def test_el_archivo_nunca_contiene_hostname_ip_ni_version(entorno):
    env, metricas = entorno

    _correr(env)

    claves = set(json.loads((metricas / "host.json").read_text()))
    assert claves == {
        "version", "escrito_en", "cpu_pct", "ram_usada_mb", "ram_total_mb",
        "swap_usada_mb", "swap_total_mb", "disco_pct", "contenedores",
    }


def test_si_docker_falla_igual_escribe_el_host_con_contenedores_vacios(entorno):
    env, metricas = entorno
    falso = Path(env["PATH"].split(":")[0]) / "docker"
    falso.write_text("#!/bin/sh\nexit 1\n")

    resultado = _correr(env)

    assert resultado.returncode == 0, resultado.stderr
    assert json.loads((metricas / "host.json").read_text())["contenedores"] == []


def test_si_no_se_puede_leer_el_host_sale_distinto_de_cero_sin_escribir(entorno):
    env, metricas = entorno
    env["MEMINFO_FILE"] = str(metricas / "no-existe")

    resultado = _correr(env)

    assert resultado.returncode == 2
    assert not (metricas / "host.json").exists()


def test_un_archivo_viejo_se_considera_no_disponible_por_el_colector(entorno):
    env, metricas = entorno
    _correr(env)
    en_el_futuro = datetime.now(timezone.utc) + timedelta(minutes=4)

    assert cm.leer_host(metricas / "host.json", en_el_futuro) is None


def test_la_primera_corrida_sin_muestra_previa_no_falla(entorno):
    env, metricas = entorno
    (metricas / ".cpu-prev").unlink()

    resultado = _correr(env)

    assert resultado.returncode == 0, resultado.stderr
    assert (metricas / ".cpu-prev").read_text().strip()
