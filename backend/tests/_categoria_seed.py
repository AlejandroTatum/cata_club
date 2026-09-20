"""Re-export delgado: la definición real del catálogo por defecto de
`categoria_horario` vive en `scripts.catalogo_default` (#1362 la promovió
desde acá para que `seed_dev_base.py` la comparta con la suite -- ver el
docstring de ese módulo para el porqué completo). Este archivo se conserva
para no tocar los imports de `test_seed_dev_base.py`/`test_seed_dev_bulk.py`,
que siguen escribiendo `from tests._categoria_seed import ...`."""
from scripts.catalogo_default import (  # noqa: F401
    CATEGORIAS_SEED,
    LUN_SAB,
    LUN_VIE,
    sembrar_categorias,
)
