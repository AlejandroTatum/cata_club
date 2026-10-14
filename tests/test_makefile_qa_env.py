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
