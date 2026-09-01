"""
Contrato estático del workflow programado de E2E en vivo (issue #901).

`.github/workflows/e2e-live.yml` levanta el stack de QA entero en un runner y
corre `make qa-live` contra él. Ejercitar eso de verdad cuesta ~20 minutos y un
Docker completo, así que este candado no lo corre: lee el YAML y verifica el
CONTRATO. Qué lo dispara, qué permisos pide, qué NO puede pedir, que destruye
el stack pase lo que pase, y qué sube como artefacto.

La afirmación que carga el peso es la de los secretos. El stack de QA se
autoabastece: `Makefile:188` genera `JWT_SECRET_KEY` con `openssl rand` en cada
invocación y `docker-compose.qa.yml:75-85` fija el SMTP a literales para que QA
no pueda heredar el proveedor del operador. Un workflow que igual declare un
secreto estaría pidiendo permiso que no necesita, y este test lo pone rojo.

La otra es la de los artefactos. `frontend/playwright.config.ts:37,53` combina
`retries: 1` bajo CI con `trace: "on-first-retry"`, así que CADA falla escribe
un trazo en `test-results/` con los encabezados `Cookie`/`Set-Cookie` de la
sesión. Se sube `playwright-report/` y nada más.

Corre FUERA de `backend/tests/`, como el resto de `tests/`: no necesita
Postgres ni fixtures de conftest, solo el archivo y pyyaml.
`.github/workflows/ci.yml:138` corre el directorio entero, así que este archivo
queda cubierto sin tocar `ci.yml`.
"""

import copy
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[1]
WORKFLOW = RAIZ / ".github" / "workflows" / "e2e-live.yml"
RUNBOOK = RAIZ / "docs" / "operations" / "e2e-live-ci.md"

# El cron que el workflow declara y que el runbook debe documentar con las
# mismas cinco posiciones. Vive acá una sola vez para que un cambio de cadencia
# que se olvide de actualizar el runbook (o al revés) quede rojo.
CRON = "17 6 * * *"

# Los comandos canónicos del Makefile. El issue pide REUTILIZARLOS, no
# reimplementar sus pasos en YAML: si el workflow inline-ara el `docker compose
# up --build --wait` de `qa-up`, se saltearía el guard de SHA y el smoke de
# Mailpit que ese target encadena (Makefile:214-233).
COMANDOS = ("make qa-up", "make qa-live", "make qa-down")


def cargar():
    """El workflow parseado. Falla explícito si el archivo todavía no existe."""
    assert WORKFLOW.is_file(), f"falta el workflow: {WORKFLOW}"
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def disparadores(wf):
    """El bloque `on:`. PyYAML resuelve `on` como el booleano True (YAML 1.1)."""
    return wf.get("on", wf.get(True)) or {}


def job_unico(wf):
    """El único job del workflow. Un segundo job partiría el teardown en dos."""
    jobs = wf.get("jobs") or {}
    assert len(jobs) == 1, f"se esperaba un job, hay {len(jobs)}"
    return next(iter(jobs.values()))


def pasos_que_usan(job, accion):
    return [p for p in job.get("steps", []) if accion in str(p.get("uses", ""))]


def verificar_no_es_vacio(wf):
    assert disparadores(wf), "el workflow no declara ningún disparador"
    job = job_unico(wf)
    assert job.get("steps"), "el job no declara ningún paso"


def verificar_disparadores(wf):
    on = disparadores(wf)
    for evento in ("schedule", "workflow_dispatch", "workflow_call"):
        assert evento in on, f"falta el disparador {evento}"
    crones = [e.get("cron") for e in on["schedule"] or []]
    assert CRON in crones, f"el cron {CRON!r} no está en {crones}"


def verificar_sin_secretos(texto):
    """Cero referencias a secretos del repositorio. Ver el docstring del módulo."""
    assert "secrets." not in texto, "el workflow referencia un secreto del repositorio"
    assert "secrets:" not in texto, "el workflow declara un bloque de secretos"


def verificar_permisos(wf):
    assert wf.get("permissions") == {"contents": "read"}, (
        f"los permisos deben ser exactamente contents: read, son {wf.get('permissions')}"
    )


def verificar_teardown(job):
    destruir = [p for p in job.get("steps", []) if "make qa-down" in str(p.get("run", ""))]
    assert destruir, "ningún paso corre `make qa-down`"
    for paso in destruir:
        assert "always()" in str(paso.get("if", "")), "el teardown no es incondicional"


def verificar_comandos_canonicos(job):
    corridas = "\n".join(str(p.get("run", "")) for p in job.get("steps", []))
    for comando in COMANDOS:
        assert comando in corridas, f"el workflow no reutiliza `{comando}`"


def verificar_checkout(job):
    checkouts = pasos_que_usan(job, "actions/checkout")
    assert checkouts, "el job no hace checkout"
    # Sin historial completo, el `git merge-base` de scripts/qa_verify_build_sha.py
    # (que `make qa-up` corre sin guarda) no puede resolver el ancestro y el
    # target cae aunque el SHA sea válido.
    for paso in checkouts:
        assert (paso.get("with") or {}).get("fetch-depth") == 0, "falta fetch-depth: 0"


def verificar_timeout(job):
    # Dos aserciones y no una compuesta: "no lo declaró" y "lo declaró en cero"
    # son defectos distintos y el rojo tiene que decir cuál de los dos es. El
    # default de 360 no es una red de seguridad, son seis horas de runner
    # tomado por un job colgado.
    limite = job.get("timeout-minutes")
    assert isinstance(limite, int), f"el job no declara timeout-minutes: {limite!r}"
    assert limite > 0, f"el timeout-minutes del job no es positivo: {limite}"


def verificar_artefactos(job):
    subidas = pasos_que_usan(job, "upload-artifact")
    assert subidas, "el job no sube ningún artefacto"
    for paso in subidas:
        con = paso.get("with") or {}
        ruta = str(con.get("path", ""))
        assert "playwright-report" in ruta, f"la subida no incluye el reporte: {ruta!r}"
        assert "test-results" not in ruta, f"la subida expone los trazos: {ruta!r}"
        assert con.get("retention-days") == 7, "la retención no son 7 días"


class TestDisparadores:
    """Las tres puertas de entrada que el issue #901 pide."""

    def test_declara_los_tres_disparadores_con_su_cron(self):
        verificar_disparadores(cargar())

    def test_el_cron_del_workflow_es_el_que_documenta_el_runbook(self):
        assert RUNBOOK.is_file(), f"falta el runbook: {RUNBOOK}"
        assert CRON in RUNBOOK.read_text(encoding="utf-8")

    def test_el_disparador_manual_recibe_un_sha(self):
        on = disparadores(cargar())
        assert "sha" in (on["workflow_dispatch"] or {}).get("inputs", {})

    def test_el_disparador_reusable_recibe_el_mismo_sha(self):
        on = disparadores(cargar())
        assert "sha" in (on["workflow_call"] or {}).get("inputs", {})


class TestSuperficieDeSecretos:
    """El stack de QA se autoabastece, así que el workflow no pide nada."""

    def test_el_workflow_no_referencia_ningun_secreto(self):
        verificar_sin_secretos(WORKFLOW.read_text(encoding="utf-8"))

    def test_los_permisos_son_de_solo_lectura(self):
        verificar_permisos(cargar())


class TestCicloDeVidaDelStack:
    """Levantar, correr y destruir con los comandos que ya existen."""

    def test_reutiliza_los_comandos_canonicos_del_makefile(self):
        verificar_comandos_canonicos(job_unico(cargar()))

    def test_el_teardown_corre_pase_lo_que_pase(self):
        verificar_teardown(job_unico(cargar()))

    def test_el_checkout_trae_el_historial_completo(self):
        verificar_checkout(job_unico(cargar()))

    def test_el_job_declara_su_propio_techo_de_tiempo(self):
        verificar_timeout(job_unico(cargar()))


class TestArtefactos:
    """Se sube el reporte; los trazos con cookies de sesión no salen del runner."""

    def test_sube_el_reporte_y_nunca_los_trazos(self):
        verificar_artefactos(job_unico(cargar()))


class TestElGateNoEsVacio:
    """Cada expectativa, vaciada a mano, tiene que poner el candado rojo."""

    def test_el_workflow_parseado_no_esta_vacio(self):
        verificar_no_es_vacio(cargar())

    def test_un_workflow_sin_disparadores_falla(self):
        with pytest.raises(AssertionError, match="disparador"):
            verificar_no_es_vacio({"jobs": {"x": {"steps": [{"run": "echo"}]}}})

    def test_un_workflow_sin_pasos_falla(self):
        with pytest.raises(AssertionError, match="ningún paso"):
            verificar_no_es_vacio({"on": {"schedule": []}, "jobs": {"x": {"steps": []}}})

    def test_una_referencia_a_un_secreto_pone_el_gate_rojo(self):
        inyectado = WORKFLOW.read_text(encoding="utf-8") + "\n# ${{ secrets.FOO }}\n"
        with pytest.raises(AssertionError, match="referencia un secreto"):
            verificar_sin_secretos(inyectado)

    def test_sumar_test_results_a_la_subida_pone_el_gate_rojo(self):
        # Sumado al reporte, no en su lugar: `path` admite varias líneas, así
        # que la regresión realista es que alguien agregue los trazos abajo.
        job = copy.deepcopy(job_unico(cargar()))
        con = pasos_que_usan(job, "upload-artifact")[0]["with"]
        con["path"] = f"{con['path']}\nfrontend/test-results/"
        with pytest.raises(AssertionError, match="expone los trazos"):
            verificar_artefactos(job)

    def test_una_retencion_distinta_pone_el_gate_rojo(self):
        job = copy.deepcopy(job_unico(cargar()))
        pasos_que_usan(job, "upload-artifact")[0]["with"]["retention-days"] = 90
        with pytest.raises(AssertionError, match="retención"):
            verificar_artefactos(job)

    def test_un_teardown_condicional_pone_el_gate_rojo(self):
        job = copy.deepcopy(job_unico(cargar()))
        for paso in job["steps"]:
            if "make qa-down" in str(paso.get("run", "")):
                paso["if"] = "success()"
        with pytest.raises(AssertionError, match="no es incondicional"):
            verificar_teardown(job)

    def test_un_teardown_ausente_pone_el_gate_rojo(self):
        job = copy.deepcopy(job_unico(cargar()))
        job["steps"] = [p for p in job["steps"] if "make qa-down" not in str(p.get("run", ""))]
        with pytest.raises(AssertionError, match="qa-down"):
            verificar_teardown(job)

    def test_un_permiso_de_escritura_pone_el_gate_rojo(self):
        with pytest.raises(AssertionError, match="contents: read"):
            verificar_permisos({"permissions": {"contents": "write"}})

    def test_un_checkout_superficial_pone_el_gate_rojo(self):
        somero = {"steps": [{"uses": "actions/checkout@v4", "with": {"fetch-depth": 1}}]}
        with pytest.raises(AssertionError, match="fetch-depth"):
            verificar_checkout(somero)

    def test_un_job_sin_techo_de_tiempo_pone_el_gate_rojo(self):
        with pytest.raises(AssertionError, match="no declara"):
            verificar_timeout({"steps": []})

    def test_un_techo_de_tiempo_en_cero_pone_el_gate_rojo(self):
        with pytest.raises(AssertionError, match="no es positivo"):
            verificar_timeout({"timeout-minutes": 0})

    def test_saltearse_un_comando_canonico_pone_el_gate_rojo(self):
        job = copy.deepcopy(job_unico(cargar()))
        job["steps"] = [p for p in job["steps"] if "make qa-live" not in str(p.get("run", ""))]
        with pytest.raises(AssertionError, match="qa-live"):
            verificar_comandos_canonicos(job)
