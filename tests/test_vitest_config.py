"""
Contrato de paralelismo de la suite unitaria del frontend (issue #1505).

`pnpm test:coverage` corría con `fileParallelism: false`, sin motivo
registrado: ~300 archivos jsdom en serie sobre un runner de 4 vCPU. Este
candado exige que los archivos corran en paralelo y que el número de workers
esté acotado de forma explícita, para que CI (4 vCPU) y local se comporten de
forma predecible.

Lee la config como texto (es TypeScript). Corre FUERA de `backend/tests/`.
"""

import re
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[1] / "frontend" / "vitest.config.ts"


def _config() -> str:
    # Sin comentarios: la prosa que menciona la opción no cuenta como config.
    text = CONFIG.read_text(encoding="utf-8")
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return re.sub(r"//[^\n]*", "", text)


def test_file_parallelism_is_not_disabled() -> None:
    assert not re.search(r"fileParallelism\s*:\s*false", _config())


def test_worker_count_is_bounded() -> None:
    assert re.search(r"maxWorkers\s*:", _config())
