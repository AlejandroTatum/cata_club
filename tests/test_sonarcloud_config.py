"""
Candado de `.sonarcloud.properties` (análisis automático de SonarQube Cloud).

El plan gratuito de la organización permite 50k LOC y el análisis sin
recortes dejaba el proyecto por encima del límite. La decisión tomada fue
limitar el análisis automático al runtime productivo del backend con
`sonar.inclusions=backend/app/**/*.py,backend/main.py`: el frontend ya tiene
su propia red en CI (type check, ESLint, Vitest, Playwright) y `docs/` no es
código que se despliegue (ver la historia en el propio `.sonarcloud.properties`).

Cuatro contratos, en orden de gravedad si se rompen:

1. La restricción vive en `sonar.inclusions` dentro de `.sonarcloud.properties`
   y no queda ninguna `sonar.exclusions` que pueda achicarlo en silencio.
   `.sonarcloud.properties` es el único archivo que el análisis automático lee
   (SonarQube Cloud ignora los parámetros de `sonar-project.properties` en ese
   modo) y la plantilla oficial del archivo lista `sonar.inclusions` entre los
   parámetros soportados; la única excepción documentada es Java/Kotlin/Scala,
   que no aplica a este backend Python.

2. Los patrones matchean con la semántica documentada de SonarQube:
   `*` = cualquier cantidad de caracteres salvo `/`, `?` = un carácter,
   `**` como segmento completo = cero o más directorios (por eso el
   `__init__.py` directo en `backend/app/` entra igual que un módulo anidado).

3. Los patrones cubren TODO el runtime productivo del backend: cada `.py` de
   `backend/` fuera de `alembic/` (migraciones), `scripts/` (tooling) y
   `tests/` tiene que matchear al menos un patrón. Si mañana aparece
   `backend/worker.py` u otro entrypoint productivo, esta prueba falla y
   ampliar el scope vuelve a ser una decisión consciente (con su impacto sobre
   el presupuesto del punto 4), no algo que Sonar empieza o deja de analizar
   en silencio.

4. Presupuesto: la suma de líneas crudas de los archivos incluidos queda bajo
   las 50.000 del plan. La métrica LOC de SonarQube nunca cuenta más líneas
   que el archivo completo (excluye comentarios y líneas en blanco), así que
   el total crudo es una cota superior determinista: si esta prueba pasa, el
   análisis no puede exceder el límite, sin depender de ninguna precisión
   inventada sobre el conteo interno de Sonar.

Vive como archivo hermano de `test_dependabot_config.py`,
`test_docker_compose_config.py` y `test_ci_workflow_imagenes.py`: candado
estructural de un archivo de configuración, sin fixtures de
`backend/tests/conftest.py` ni Postgres. El paso de root-level tests de
`ci.yml` corre `tests/` entero (`uv run pytest ../tests/`), así que queda
cubierto sin tocar el workflow.
"""

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
PROPIEDADES = RAIZ / ".sonarcloud.properties"

# Valor fijado por la decisión: runtime productivo del backend, nada más.
INCLUSIONES_ESPERADAS = "backend/app/**/*.py,backend/main.py"

# Límite de LOC del plan gratuito de la organización.
LIMITE_LOC_PLAN = 50_000

# Directorios de `backend/` que NO son runtime productivo y quedan
# deliberadamente fuera del análisis automático.
FUERA_DEL_RUNTIME = {"alembic", "scripts", "tests"}


def _leer_propiedades() -> dict[str, str]:
    """Parsea pares `clave=valor` ignorando comentarios `#` y líneas vacías."""
    propiedades: dict[str, str] = {}
    for linea in PROPIEDADES.read_text(encoding="utf-8").splitlines():
        linea = linea.strip()
        if not linea or linea.startswith("#"):
            continue
        clave, _, valor = linea.partition("=")
        propiedades[clave.strip()] = valor.strip()
    return propiedades


def _patrones_inclusion() -> list[str]:
    valor = _leer_propiedades()["sonar.inclusions"]
    return [patron for patron in (p.strip() for p in valor.split(",")) if patron]


def _patron_sonar_a_regex(patron: str) -> re.Pattern[str]:
    """Traduce un patrón de path SonarQube a regex anclada.

    Semántica documentada: `*` = cero o más caracteres salvo `/`, `?` = un
    carácter, y `**` como segmento completo = cero o más directorios.
    """
    segmentos = patron.split("/")
    regex = ""
    for indice, segmento in enumerate(segmentos):
        es_ultimo = indice == len(segmentos) - 1
        if segmento == "**":
            regex += "(?:[^/]+/)*" if not es_ultimo else ".*"
            continue
        regex += "".join(
            "[^/]*" if c == "*" else "[^/]" if c == "?" else re.escape(c)
            for c in segmento
        )
        if not es_ultimo:
            regex += "/"
    return re.compile("^" + regex + "$")


def _runtime_del_backend() -> list[str]:
    """Lista los `.py` productivos de `backend/`, con path relativo a la raíz.

    Excluye migraciones, tooling, tests y cualquier directorio oculto
    (`.venv` local, caches). Todo lo que no caiga en esas bolsas cuenta como
    runtime: si aparece un `.py` nuevo fuera de `backend/app/`, esta lista lo
    incluye y el test de cobertura lo exige.
    """
    runtime: list[str] = []
    for archivo in sorted((RAIZ / "backend").rglob("*.py")):
        partes = archivo.relative_to(RAIZ).parts
        if any(parte.startswith(".") for parte in partes):
            continue
        if FUERA_DEL_RUNTIME.intersection(partes):
            continue
        runtime.append("/".join(partes))
    return runtime


def test_la_restriccion_vive_en_sonar_inclusions_sin_exclusions_que_la_achiquen():
    propiedades = _leer_propiedades()
    assert propiedades.get("sonar.inclusions") == INCLUSIONES_ESPERADAS
    # Una `sonar.exclusions` podría sacar del análisis archivos de runtime que
    # `sonar.inclusions` sí cubre, en silencio. Si algún día hace falta una,
    # agregarla acá tiene que ser una decisión consciente.
    assert "sonar.exclusions" not in propiedades


def test_los_patrones_matchean_con_la_semantica_de_sonar():
    patrones = [_patron_sonar_a_regex(p) for p in _patrones_inclusion()]

    def matchea(ruta: str) -> bool:
        return any(patron.match(ruta) for patron in patrones)

    # `**` matchea cero o más directorios: el `__init__.py` directo en `app/`
    # entra igual que un módulo profundamente anidado.
    assert matchea("backend/app/__init__.py")
    assert matchea("backend/app/api/rutas.py")
    assert matchea("backend/app/infraestructura/tareas/celery_app.py")
    assert matchea("backend/main.py")
    # Y lo que quedó fuera de la decisión, no.
    assert not matchea("backend/alembic/versions/0001_inicial.py")
    assert not matchea("backend/scripts/crear_primer_admin.py")
    assert not matchea("backend/tests/test_ejemplo.py")
    assert not matchea("frontend/src/app/page.tsx")
    assert not matchea("docs/archive/prototypes/mockup.html")


def test_los_patrones_cubren_todo_el_runtime_del_backend():
    runtime = _runtime_del_backend()
    assert runtime, "la superficie de runtime no puede quedar vacía"
    patrones = [_patron_sonar_a_regex(p) for p in _patrones_inclusion()]
    sin_cobertura = [
        ruta for ruta in runtime if not any(p.match(ruta) for p in patrones)
    ]
    assert sin_cobertura == [], (
        "archivos de runtime productivo sin cobertura de sonar.inclusions: "
        f"{sin_cobertura}"
    )


def test_el_presupuesto_loc_queda_bajo_el_limite_del_plan():
    patrones = [_patron_sonar_a_regex(p) for p in _patrones_inclusion()]
    incluidas = [
        ruta
        for ruta in _runtime_del_backend()
        if any(patron.match(ruta) for patron in patrones)
    ]
    loc_crudas = sum(
        len((RAIZ / ruta).read_text(encoding="utf-8").splitlines())
        for ruta in incluidas
    )
    assert 0 < loc_crudas < LIMITE_LOC_PLAN, (
        f"las líneas crudas del conjunto incluido ({loc_crudas}) deben quedar "
        f"bajo el límite del plan ({LIMITE_LOC_PLAN})"
    )
