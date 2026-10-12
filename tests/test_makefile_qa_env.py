"""`make qa-up` debe usar el builder clásico de Compose (COMPOSE_BAKE=false).

Con Docker Compose 5.6 el build vía bake falla con "pass --allow=network.host".
La variable viaja en `QA_ENV`, así que cubre solo los targets de QA.
"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _dry_run(target: str) -> str:
    return subprocess.run(
        ["make", "-n", "-C", str(ROOT), target],
        capture_output=True, text=True, check=True,
    ).stdout


def test_qa_up_builds_with_the_classic_builder():
    comandos = [l for l in _dry_run("qa-up").splitlines() if " up -d --build " in l]
    assert comandos, "qa-up no levanta el stack con `up --build`"
    assert all("COMPOSE_BAKE=false" in l for l in comandos)


def test_compose_bake_is_scoped_to_qa_targets():
    assert "COMPOSE_BAKE" not in _dry_run("dev")
