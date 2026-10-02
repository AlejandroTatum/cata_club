"""Contrato del Makefile para la suite paralela (issue #1505).

Sin Postgres ni fixtures: solo lee el texto del Makefile."""
import re
from pathlib import Path

MAKEFILE = Path(__file__).resolve().parent.parent / "Makefile"


def _receta(objetivo: str) -> str:
    texto = MAKEFILE.read_text(encoding="utf-8")
    coincidencia = re.search(
        rf"^{re.escape(objetivo)}:.*\n((?:\t.*\n?)+)", texto, re.MULTILINE
    )
    assert coincidencia, f"no existe el objetivo {objetivo}"
    return coincidencia.group(1)


def test_test_backend_corre_en_paralelo():
    receta = _receta("test-backend")
    assert "-n auto" in receta
    assert "--dist worksteal" in receta
