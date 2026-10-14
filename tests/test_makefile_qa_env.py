"""`make qa-up` debe construir con Docker Compose >= 5 (siempre vía Bake).

Bake rechaza un build con `network: host` ("pass --allow=network.host") y
Compose no puede pasarle esa autorización; `COMPOSE_BAKE=false` ya no existe
como salida. Por eso el default es construir sobre la red `default`, y el host
network queda como opt-in (`CATA_BUILD_NETWORK=host`) con la autorización
explícita de `docker buildx bake`.
"""

import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SERVICIOS_CON_BUILD = ("backend", "celery-worker", "celery-beat", "frontend")


def _dry_run(target: str, *args: str) -> str:
    return subprocess.run(
        ["make", "-n", "-C", str(ROOT), target, *args],
        capture_output=True, text=True, check=True,
    ).stdout


def _redes_de_build(red: str | None) -> dict[str, str]:
    entorno = {**os.environ, "JWT_SECRET_KEY": "clave-de-descarte-solo-para-tests"}
    entorno.pop("CATA_BUILD_NETWORK", None)
    if red is not None:
        entorno["CATA_BUILD_NETWORK"] = red
    salida = subprocess.run(
        [
            "docker", "compose",
            "-f", "docker-compose.yml",
            "-f", "docker-compose.override.yml",
            "-f", "docker-compose.qa.yml",
            "config", "--format", "json",
        ],
        cwd=ROOT, env=entorno, capture_output=True, text=True, check=True,
    ).stdout
    servicios = json.loads(salida)["services"]
    return {n: servicios[n]["build"]["network"] for n in SERVICIOS_CON_BUILD}


def test_qa_up_ya_no_depende_de_compose_bake():
    # La variable fue eliminada de Compose 5: dejarla en `QA_ENV` sugeriría un
    # builder clásico que no existe.
    assert "COMPOSE_BAKE" not in _dry_run("qa-up")


def test_qa_up_construye_con_up_build_por_defecto():
    comandos = _dry_run("qa-up").splitlines()
    assert any(" up -d --build --wait " in l for l in comandos), (
        "qa-up no levanta el stack con `up --build`"
    )
    assert not any("buildx bake" in l for l in comandos)


def test_el_build_de_desarrollo_y_qa_no_pide_el_privilegio_network_host():
    redes = _redes_de_build(None)
    assert redes == {n: "default" for n in SERVICIOS_CON_BUILD}, (
        f"Bake no puede construir con `network: host` sin `--allow` que "
        f"Compose no pasa; el default debe ser `default`: {redes}"
    )


def test_el_host_network_es_opt_in_y_se_construye_con_la_autorizacion_explicita():
    assert _redes_de_build("host") == {n: "host" for n in SERVICIOS_CON_BUILD}

    comandos = _dry_run("qa-up", "CATA_BUILD_NETWORK=host").splitlines()
    assert any("buildx bake --allow network.host" in l for l in comandos)
    # `up --build` volvería a pedir el privilegio que Compose no puede dar.
    assert not any(" up -d --build " in l for l in comandos)
    assert any(" up -d  --wait " in l or " up -d --wait " in l for l in comandos)


# --- La receta opt-in de host network (#1787-k) ------------------------------


def _qa_up_con_stubs(tmp_path: Path, *, print_falla: bool) -> tuple[subprocess.CompletedProcess, list[str]]:
    """Corre `make qa-up CATA_BUILD_NETWORK=host` con `git` y `docker` de mentira.

    `git` y `python3` también son de mentira. El `docker` de mentira anota cada invocación; `compose ... build --print`
    falla cuando `print_falla` y `buildx bake` consume su stdin y sale en 0,
    como haría un bake que recibe una definición vacía.
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "docker.log"
    (bin_dir / "git").write_text("#!/bin/sh\necho abcdef1\n")
    # Los guards de después del seed hablan con el stack real: acá no corren.
    (bin_dir / "python3").write_text("#!/bin/sh\nexit 0\n")
    (bin_dir / "docker").write_text(
        "#!/bin/sh\n"
        'echo "$*" >> "$DOCKER_LOG"\n'
        'case " $* " in\n'
        '  *" build --print "*) [ "$PRINT_FALLA" = 1 ] && { echo "boom" >&2; exit 1; }; echo "{}" ;;\n'
        '  *" buildx bake "*) cat >/dev/null ;;\n'
        "esac\n"
        "exit 0\n"
    )
    for nombre in ("git", "python3", "docker"):
        (bin_dir / nombre).chmod(0o755)
    entorno = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "DOCKER_LOG": str(log),
        "PRINT_FALLA": "1" if print_falla else "0",
    }
    resultado = subprocess.run(
        ["make", "-C", str(ROOT), "qa-up", "CATA_BUILD_NETWORK=host"],
        env=entorno, capture_output=True, text=True,
    )
    llamadas = log.read_text().splitlines() if log.exists() else []
    return resultado, llamadas


def test_el_prebuild_host_corta_el_target_si_compose_build_print_falla(tmp_path):
    # Sin `pipefail`, el status del pipe es el de `buildx bake`: un `build
    # --print` roto pasaba como éxito y `up` seguía con imágenes viejas.
    resultado, llamadas = _qa_up_con_stubs(tmp_path, print_falla=True)

    assert resultado.returncode != 0
    assert not any(" up -d " in f" {l} " for l in llamadas), llamadas


def test_el_prebuild_host_carga_las_imagenes_en_el_almacen_local(tmp_path):
    # Con un builder no predeterminado (docker-container) el resultado de bake
    # queda en la caché del builder salvo `--load`; `up` no las encontraría.
    resultado, llamadas = _qa_up_con_stubs(tmp_path, print_falla=False)

    assert resultado.returncode == 0, resultado.stderr
    bake = [l for l in llamadas if "buildx bake" in l]
    assert len(bake) == 1 and "--load" in bake[0].split() and "--allow network.host" in bake[0]


# --- El bloqueo por impago nace activo en QA (#1787-l) -------------------------


def test_qa_fija_la_fecha_de_lanzamiento_del_bloqueo_por_impago():
    comandos = _dry_run("qa-up").splitlines()
    levantar = [l for l in comandos if " up -d " in l]

    assert levantar and all(
        "BLOQUEO_IMPAGO_FECHA_LANZAMIENTO=2026-10-13" in l for l in levantar
    ), levantar
    # Las demás invocaciones de Compose del entorno ven el mismo valor.
    assert "BLOQUEO_IMPAGO_FECHA_LANZAMIENTO=2026-10-13" in _dry_run("qa-down")
