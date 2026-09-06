"""
Candado de `.github/dependabot.yml` (PR #1113).

El PR #1096 agregó `dependabot.yml` con tres ecosistemas (`npm`, `uv`,
`github-actions`) sin ningún límite ni agrupación, y al minuto Dependabot
abrió 13 PRs de version updates, varios saltos de major que nadie pidió
(bcrypt 4->5, typescript 5.9->6.0, entre otros). El PR #1113 le agregó a
cada ecosistema un `open-pull-requests-limit`, un `groups` que agrupa
`minor`+`patch` en un único PR, y un `ignore` que saca los `major` del
canal automático (se deciden a mano; el canal separado de
`dependabot_security_updates` sigue cubriendo seguridad aunque esté
`disabled` hoy, ver el comentario del propio archivo).

Nada impide que alguien borre esas tres restricciones "para destrabar un
update" sin darse cuenta de que así vuelven los 13 PRs. Este archivo cierra
eso: itera los tres ecosistemas y falla si a CUALQUIERA le falta el límite,
el agrupamiento de minor/patch o el ignore de major -- y falla también si
aparece un cuarto ecosistema sin las tres restricciones.

Vive como archivo hermano de `test_docker_compose_config.py` y
`test_ci_workflow_imagenes.py`, no extiende ninguno de los dos: el primero
es específicamente sobre el compose de producción (nombre y docstring lo
dicen) y el segundo es específicamente sobre `ci.yml`; forzar este
contrato en cualquiera de los dos rompería lo que ese nombre promete.
`test_ci_workflow_imagenes.py` es el precedente más cercano en forma
(config de `.github/` parseada con pyyaml, sin fixtures de
`backend/tests/conftest.py`) y este archivo sigue el mismo patrón.

Corre FUERA de `backend/tests/`, como los dos anteriores: no necesita
Postgres ni ningún fixture de conftest, solo el archivo y pyyaml.
`.github/workflows/ci.yml:138` corre el directorio `tests/` entero, así
que este archivo queda cubierto sin tocar `ci.yml`.
"""

from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[1]
DEPENDABOT = RAIZ / ".github" / "dependabot.yml"

# Ecosistemas que el PR #1096 declaró y el PR #1113 restringió. Si mañana se
# agrega un cuarto ecosistema, agregarlo acá es lo que lo trae bajo este
# candado; si no se agrega, `test_todos_los_ecosistemas_esperados_estan_presentes`
# falla por default porque compara contra este set exacto.
ECOSISTEMAS_ESPERADOS = {
    "npm": "/frontend",
    "uv": "/backend",
    "github-actions": "/",
}


def cargar():
    """El config completo parseado. Falla explícito si todavía no existe."""
    assert DEPENDABOT.is_file(), f"falta el config: {DEPENDABOT}"
    return yaml.safe_load(DEPENDABOT.read_text(encoding="utf-8"))


def updates(config):
    lista = config.get("updates")
    assert isinstance(lista, list) and lista, "dependabot.yml no declara ningún 'updates'"
    return lista


def update_types_de_ignore(entrada_update):
    """Todos los `update-types` de todas las entradas de `ignore` de un
    `update`, aplanados en un solo set."""
    tipos = set()
    for regla in entrada_update.get("ignore") or []:
        tipos.update(regla.get("update-types") or [])
    return tipos


def update_types_de_groups(entrada_update):
    """Todos los `update-types` de todos los grupos de un `update`, aplanados
    en un solo set."""
    tipos = set()
    for grupo in (entrada_update.get("groups") or {}).values():
        tipos.update(grupo.get("update-types") or [])
    return tipos


def test_el_archivo_parsea_como_yaml_version_2():
    config = cargar()
    assert config.get("version") == 2


def test_todos_los_ecosistemas_esperados_estan_presentes():
    config = cargar()
    encontrados = {
        entrada.get("package-ecosystem"): entrada.get("directory")
        for entrada in updates(config)
    }
    assert encontrados == ECOSISTEMAS_ESPERADOS


def test_cada_ecosistema_declara_open_pull_requests_limit():
    config = cargar()
    for entrada in updates(config):
        ecosistema = entrada.get("package-ecosystem")
        assert "open-pull-requests-limit" in entrada, (
            f"{ecosistema} no declara open-pull-requests-limit"
        )
        assert isinstance(entrada["open-pull-requests-limit"], int)


def test_cada_ecosistema_agrupa_minor_y_patch():
    config = cargar()
    for entrada in updates(config):
        ecosistema = entrada.get("package-ecosystem")
        tipos = update_types_de_groups(entrada)
        assert "minor" in tipos, f"{ecosistema} no agrupa updates minor"
        assert "patch" in tipos, f"{ecosistema} no agrupa updates patch"


def test_cada_ecosistema_ignora_los_majors():
    config = cargar()
    for entrada in updates(config):
        ecosistema = entrada.get("package-ecosystem")
        tipos = update_types_de_ignore(entrada)
        assert "version-update:semver-major" in tipos, (
            f"{ecosistema} no ignora version-update:semver-major"
        )
