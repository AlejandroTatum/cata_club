"""
Structural contract for dependency vulnerability gates in CI (issue #1063).

The frontend installs npm dependencies in CI but must also fail on high or
critical advisories. This root-level test keeps that gate visible in the
workflow instead of relying on a manual review of the YAML.
"""

from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[1]
WORKFLOW = RAIZ / ".github" / "workflows" / "ci.yml"


def cargar():
    """The workflow parsed. Fail explicitly if it does not exist."""
    assert WORKFLOW.is_file(), f"missing workflow: {WORKFLOW}"
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def job_frontend(workflow):
    job = (workflow.get("jobs") or {}).get("frontend")
    assert job is not None, "ci.yml has no frontend job"
    return job


def test_frontend_ci_audits_high_vulnerabilities():
    """The frontend dependency audit must be a real, blocking CI step."""
    pasos = job_frontend(cargar()).get("steps", [])
    auditorias = [
        paso
        for paso in pasos
        if "pnpm audit --audit-level=high" in str(paso.get("run", ""))
    ]
    assert len(auditorias) == 1, (
        "frontend CI must run exactly one blocking pnpm audit --audit-level=high step"
    )

    instalacion = [
        indice
        for indice, paso in enumerate(pasos)
        if "pnpm install --frozen-lockfile" in str(paso.get("run", ""))
    ]
    auditoria = pasos.index(auditorias[0])
    assert len(instalacion) == 1, "frontend CI must install the frozen lockfile exactly once"
    assert auditoria > instalacion[0], "frontend audit must run after dependency installation"
