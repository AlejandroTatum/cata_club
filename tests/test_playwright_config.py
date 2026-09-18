"""
Contrato de concurrencia del E2E en CI (issue #1290).

El job `frontend` de `ci.yml` corre UNA vez `pnpm exec playwright test` contra
UN servidor Next independiente (`node .next/standalone/server.js`, ver
`frontend/playwright.config.ts`) sobre un runner de 4 vCPU. Con `workers: 4`
los cuatro workers comparten esos vCPU con el servidor, y el presupuesto de
30 s por test se agota en `page.goto` dentro de specs de navegación pública que
el push no tocó.

Las DOS expiraciones fueron idénticas en pushes a `main` sin relación entre sí.
Eso es CONSISTENTE con contención de CPU, no prueba de ella: este candado no
afirma una causa. Congela la política elegida -- `workers: 2` en CI, que
reserva capacidad del runner para el servidor compartido, sin tocar el timeout
ni agregar esperas de readiness -- para que subir los workers de vuelta, o
dejar que el workflow los pise por línea de comandos, ponga el gate rojo.

Lee la config como texto (es TypeScript) y el workflow como YAML. Corre FUERA
de `backend/tests/`, como el resto de `tests/`: no necesita Postgres.
"""

import re
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[1]
CONFIG = RAIZ / "frontend" / "playwright.config.ts"
WORKFLOW = RAIZ / ".github" / "workflows" / "ci.yml"

# Concurrencia congelada por entorno: política conservadora elegida en #1290,
# no una derivación. CI comparte 4 vCPU entre los workers Y el servidor Next,
# así que 2 reserva capacidad del runner para el servidor; local corre 1 worker
# para no competir con lo que el desarrollador ya tiene abierto. Cambiar
# cualquiera de los dos exige editar este contrato.
WORKERS_CI = 2
WORKERS_LOCAL = 1
VCPU_RUNNER = 4

PATRON_WORKERS = re.compile(r"workers:\s*process\.env\.CI\s*\?\s*(\d+)\s*:\s*(\d+)")


def cargar(ruta: Path) -> str:
    """El archivo como texto. Falla explícito si todavía no existe."""
    assert ruta.is_file(), f"falta el archivo: {ruta}"
    return ruta.read_text(encoding="utf-8")


def concurrencia(texto: str) -> tuple[int, int]:
    """(workers en CI, workers locales) declarados en la config."""
    coincidencias = PATRON_WORKERS.findall(texto)
    assert len(coincidencias) == 1, (
        "se esperaba exactamente un `workers: process.env.CI ? N : M` en "
        f"playwright.config.ts, hay {len(coincidencias)}"
    )
    ci, local = coincidencias[0]
    return int(ci), int(local)


def verificar_concurrencia(texto: str, esperado_ci: int = WORKERS_CI) -> None:
    """Tres aserciones separadas: la política de CI, que no supere los vCPU, y
    que local no cambie.

    `esperado_ci` existe para que la aserción de vCPU sea alcanzable en un test
    de mutación: con el valor congelado, `2 == 2` la dejaría inerte.
    """
    ci, local = concurrencia(texto)
    assert ci == esperado_ci, f"los workers de CI deben ser {esperado_ci}, son {ci}"
    assert ci < VCPU_RUNNER, (
        f"CI no puede correr {ci} workers sobre {VCPU_RUNNER} vCPU compartidos "
        "con el servidor Next"
    )
    assert local == WORKERS_LOCAL, f"los workers locales deben ser {WORKERS_LOCAL}, son {local}"


def paso_e2e() -> dict:
    """El paso que corre Playwright en el job `frontend` de `ci.yml`."""
    assert WORKFLOW.is_file(), f"falta el workflow: {WORKFLOW}"
    wf = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    job = (wf.get("jobs") or {}).get("frontend")
    assert job is not None, "ci.yml no tiene job `frontend`"
    pasos = [p for p in job.get("steps", []) if "playwright test" in str(p.get("run", ""))]
    assert len(pasos) == 1, f"se esperaba un paso de Playwright, hay {len(pasos)}"
    return pasos[0]


class TestConcurrenciaDeclarada:
    """La config es la única autoridad sobre cuántos workers abre CI."""

    def test_ci_baja_la_concurrencia_por_debajo_de_los_vcpu(self):
        verificar_concurrencia(cargar(CONFIG))

    def test_la_config_documenta_por_que_hay_un_techo(self):
        """Sin el motivo escrito, el próximo ajuste "optimiza" los 4 de vuelta."""
        texto = cargar(CONFIG)
        assert "vCPU" in texto and "standalone" in texto, (
            "la config debe explicar el techo de concurrencia (vCPU del runner "
            "y servidor standalone compartido)"
        )


class TestElWorkflowNoPisaLaConfig:
    """`--workers` por línea de comandos volvería decorativo al contrato."""

    def test_el_paso_e2e_no_fuerza_workers(self):
        paso = paso_e2e()
        run = str(paso.get("run", ""))
        assert "--workers" not in run, f"el paso E2E pisa la config: {run!r}"


class TestElGateNoEsVacio:
    """Cada expectativa, invertida a mano, tiene que poner el candado rojo."""

    def test_no_se_parsea_una_config_vacia(self):
        with pytest.raises(AssertionError, match="exactamente un"):
            concurrencia("export default defineConfig({});")

    def test_volver_a_cuatro_workers_en_ci_pone_el_gate_rojo(self):
        texto = cargar(CONFIG).replace(
            f"workers: process.env.CI ? {WORKERS_CI} : {WORKERS_LOCAL}",
            "workers: process.env.CI ? 4 : 1",
        )
        with pytest.raises(AssertionError, match="workers de CI deben ser 2"):
            verificar_concurrencia(texto)

    def test_superar_los_vcpu_del_runner_pone_el_gate_rojo(self):
        with pytest.raises(AssertionError, match="vCPU compartidos"):
            verificar_concurrencia("workers: process.env.CI ? 8 : 1", esperado_ci=8)

    def test_mover_los_workers_locales_pone_el_gate_rojo(self):
        with pytest.raises(AssertionError, match="workers locales deben ser 1"):
            verificar_concurrencia("workers: process.env.CI ? 2 : 4")
