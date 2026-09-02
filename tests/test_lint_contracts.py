"""
Contrato estático de los candados de complejidad y arquitectura (issue #832).

Ruff corría con el set mínimo por defecto, sin ninguna regla de complejidad,
y no había ninguna herramienta que verificara la dirección de los imports
entre capas. Sin esos candados, cualquier limpieza que se hiciera se volvía a
llenar de a una, sin que nada avisara (16 imports de `servicios_negocio` a
`presentacion`, ver #829).

Las ocho funciones que superan el umbral 12 se eximen por ARCHIVO en
`[tool.ruff.lint.per-file-ignores]`, no con `# noqa: C901` en la línea `def`:
un `noqa` ahí arrastra la función entera (con su deuda histórica) al "new
code" de SonarCloud y rompe el Quality Gate del propio PR que agrega el
candado. La exención por archivo es más ancha, así que este archivo agrega
el candado function-granular que la achica de vuelta: corre ruff aislado
(sin `per-file-ignores`, para que la exención no tape nada) solo sobre esos
siete archivos y falla si aparece una función compleja que no esté en la
lista declarada.

Este archivo no ejecuta `lint-imports` de verdad — eso ya lo hace CI en su
propio paso, sobre código real. Lo que verifica de ese candado es que la
DECLARACIÓN exista y no se pueda aflojar sin que el diff lo muestre: el
umbral de `C901`, los tres contratos de `import-linter`, y que CI corra
`lint-imports` después de `ruff check`.

Corre FUERA de `backend/tests/`, como el resto de `tests/`: no necesita
Postgres ni fixtures de conftest, solo los archivos de configuración,
`pyyaml`/`tomllib`, y el propio ruff instalado en `backend/.venv`.
`.github/workflows/ci.yml` corre el directorio entero, así que este archivo
queda cubierto sin tocar `ci.yml`.
"""

import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[1]
BACKEND = RAIZ / "backend"
PYPROJECT = BACKEND / "pyproject.toml"
WORKFLOW = RAIZ / ".github" / "workflows" / "ci.yml"

# Mismos archivos que `[tool.ruff.lint.per-file-ignores]` exime de C901.
ARCHIVOS_EXIMIDOS_DE_C901 = [
    "app/infraestructura/tareas/alertas_tareas.py",
    "app/servicios_negocio/admin_cuenta_servicio.py",
    "app/servicios_negocio/enrollment_servicio.py",
    "app/servicios_negocio/membresia_pago_servicio.py",
    "scripts/seed_dev_base.py",
    "scripts/seed_dev_bulk.py",
    "tests/test_bloqueo_del_event_loop.py",
]

# Funciones que ya superaban el umbral 12 al declarar la deuda (#832). La
# exención por archivo es un piso: solo puede achicarse a medida que se
# refactoricen, nunca crecer con una función nueva sin que este test reviente.
FUNCIONES_CON_DEUDA_DECLARADA = {
    "enroll",
    "corregir_pago",
    "registrar_pago",
    "adjuntar_voucher",
    "crear_cuenta",
    "alertar_mora_diaria",
    "main",
    "destino",
}


def cargar_pyproject():
    """`backend/pyproject.toml` parseado. Falla explícito si no existe."""
    assert PYPROJECT.is_file(), f"falta el archivo: {PYPROJECT}"
    return tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))


def cargar_workflow():
    """El workflow completo parseado. Falla explícito si todavía no existe."""
    assert WORKFLOW.is_file(), f"falta el workflow: {WORKFLOW}"
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def job_backend(wf):
    job = (wf.get("jobs") or {}).get("backend")
    assert job is not None, "no existe el job 'backend' en ci.yml"
    return job


def test_c901_esta_activo_con_umbral_12():
    """Sin `C901` en el `select`, cualquier función puede crecer sin límite
    de complejidad sin que ruff diga nada. El umbral 12 es la decisión de
    #832: deja pasar todo salvo las ocho funciones eximidas por archivo."""
    pyproject = cargar_pyproject()
    select = pyproject["tool"]["ruff"]["lint"]["select"]
    assert "C901" in select

    max_complexity = pyproject["tool"]["ruff"]["lint"]["mccabe"]["max-complexity"]
    assert max_complexity == 12


def test_los_archivos_eximidos_de_c901_no_esconden_funciones_nuevas():
    """La exención de `[tool.ruff.lint.per-file-ignores]` es por ARCHIVO, no
    por función: sin este candado, cualquiera podría agregar una función
    nueva de complejidad 50 a `membresia_pago_servicio.py` y `ruff check .`
    seguiría en verde. Corre ruff AISLADO (`--isolated`, sin el pyproject.toml
    del repo) para que la propia exención no tape el hallazgo, y exige que
    todo lo que aparezca ya esté en la lista declarada como deuda de #832."""
    rutas = [str(BACKEND / archivo) for archivo in ARCHIVOS_EXIMIDOS_DE_C901]
    resultado = subprocess.run(
        [
            sys.executable, "-m", "ruff", "check", *rutas,
            "--select", "C901",
            "--config", "lint.mccabe.max-complexity=12",
            "--output-format", "json",
            "--isolated",
        ],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        check=False,
    )
    hallazgos = json.loads(resultado.stdout)

    patron = re.compile(r"^`([^`]+)` is too complex")
    nombres_encontrados = set()
    for hallazgo in hallazgos:
        coincidencia = patron.match(hallazgo["message"])
        assert coincidencia, f"mensaje inesperado de C901: {hallazgo['message']}"
        nombres_encontrados.add(coincidencia.group(1))

    sin_declarar = nombres_encontrados - FUNCIONES_CON_DEUDA_DECLARADA
    assert not sin_declarar, (
        f"función(es) compleja(s) nueva(s) sin declarar en #832: {sin_declarar}"
    )


def test_contrato_de_capas_prohibe_servicios_negocio_hacia_presentacion():
    """El contrato mínimo de #832: la capa de aplicación no puede depender de
    la web. Si desaparece, un nuevo import de `presentacion` en
    `servicios_negocio` no rompe nada."""
    pyproject = cargar_pyproject()
    contratos = pyproject["tool"]["importlinter"]["contracts"]

    capas = [c for c in contratos if c.get("source_modules") == ["app.servicios_negocio"]]
    assert len(capas) == 1, "se esperaba exactamente un contrato desde app.servicios_negocio"

    contrato = capas[0]
    assert contrato["type"] == "forbidden"
    assert contrato["forbidden_modules"] == ["app.presentacion"]


def test_importlinter_declara_los_tres_contratos_de_capas():
    """`app.dominio` es el núcleo: no puede depender de ninguna otra capa. Si
    algún día alguien le agrega un import de `presentacion`, `servicios_negocio`
    o `infraestructura`, el candado tiene que reventar sin excepciones."""
    pyproject = cargar_pyproject()
    contratos = pyproject["tool"]["importlinter"]["contracts"]
    assert len(contratos) == 3
    assert all(c["type"] == "forbidden" for c in contratos)

    dominio = [c for c in contratos if c.get("source_modules") == ["app.dominio"]]
    assert len(dominio) == 1
    assert set(dominio[0]["forbidden_modules"]) == {
        "app.presentacion",
        "app.servicios_negocio",
        "app.infraestructura",
    }
    assert not dominio[0].get("ignore_imports"), "el dominio no tiene deuda declarada hoy"


def test_ci_corre_lint_imports_despues_de_ruff_check():
    """Un contrato en `pyproject.toml` que no corre en CI no protege nada:
    #832 pide explícito que el pipeline se ponga rojo ante una violación
    nueva. El paso tiene que existir y correr DESPUÉS del `ruff check`."""
    job = job_backend(cargar_workflow())
    pasos = job.get("steps", [])

    indices_ruff = [
        i for i, p in enumerate(pasos) if "ruff check" in str(p.get("run", ""))
    ]
    assert len(indices_ruff) == 1, "se esperaba un único paso que corra ruff check"

    indices_imports = [
        i for i, p in enumerate(pasos) if "lint-imports" in str(p.get("run", ""))
    ]
    assert len(indices_imports) == 1, "se esperaba un único paso que corra lint-imports"

    assert indices_imports[0] > indices_ruff[0]
