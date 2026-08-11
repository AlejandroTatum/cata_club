"""
Candado preventivo: Alembic debe tener exactamente UNA cabeza.

Motivación (mecanismo real, no hipotético): dos ramas de la misma tanda de
fixes pueden agregar una migración cada una colgando del mismo
`down_revision`. Cada cadena, vista sola en su propia rama, es lineal --
el conflicto solo existe al MERGEAR ambas, y hasta este test nada lo
detectaba antes de que alguien corriera `alembic upgrade head` contra una
base real y Alembic reventara con dos cabezas. Este repo ya acumuló tres
migraciones de fusión y 31 revisiones por este patrón exacto (ver
`docs/auditoria-qa/README.md`); `pendientes.md` sugería este candado y
nunca se escribió.

Corre FUERA de la suite de `backend/tests/` a propósito, igual que
`test_docker_compose_config.py` -- ese directorio tiene un fixture
`esquema_migrado` (`scope="session", autouse=True`) que corre `alembic
upgrade head` contra Postgres real para TODA la sesión, sin importar si el
test individual lo necesita. Viviendo ahí, este test heredaría esa
dependencia aunque nunca la use. Acá afuera, `ScriptDirectory.from_config`
solo lee los archivos de `alembic/versions/` y arma el grafo de revisiones
en memoria -- no ejecuta `alembic/env.py` ni abre conexión alguna. Invocar
con: `cd backend && uv run pytest ../tests/test_alembic_cabeza_unica.py`
(ver `make test-compose` para el precedente del mismo patrón).
"""
import os

from alembic.config import Config as AlembicConfig
from alembic.script import ScriptDirectory

RAIZ_BACKEND = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend")


def test_alembic_tiene_una_sola_cabeza():
    configuracion = AlembicConfig(os.path.join(RAIZ_BACKEND, "alembic.ini"))
    script = ScriptDirectory.from_config(configuracion)
    cabezas = script.get_heads()

    assert len(cabezas) == 1, (
        f"Alembic tiene {len(cabezas)} cabezas, no 1: {cabezas}. Esto pasa "
        "cuando dos migraciones de ramas distintas quedan apuntando al "
        "mismo down_revision -- cada rama, sola, es lineal; el choque solo "
        "aparece al mergear. NO crear una migración de fusión (merge "
        "revision): es la reacción instintiva y es exactamente lo que "
        "produjo las tres fusiones que ya tiene este repo. En cambio, "
        "re-apuntar el `down_revision` de la revisión que se mergeó "
        "DESPUÉS para que cuelgue de la que se mergeó primero (la que ya "
        "estaba en `origin/main`), dejando una sola cadena lineal, y correr "
        "este test de nuevo hasta que quede una sola cabeza."
    )
