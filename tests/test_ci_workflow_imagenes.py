"""
Contrato estático del job de imágenes de producción en `ci.yml` (issue #927).

El issue #927 afirmaba que la imagen de frontend se construía sin `BUILD_SHA`
y que por eso `/api/health` respondía `unknown` en producción. La premisa
estaba vieja: desde el PR #425 (commit 9e4d81e) el paso "Build frontend
image" ya pasa `BUILD_SHA=${{ env.IMAGE_TAG }}` como build-arg. El `rg` del
issue se había saltado `.github/` por ser un directorio oculto.

Lo que sí faltaba, y lo que este archivo cierra, es un candado que falle si
esa ruta deja de estar cableada: que `IMAGE_TAG` sea un SHA inmutable, que el
build-arg del frontend siga ahí, que exista un paso que verifique en runtime
que la imagen sirve esa revisión ANTES de publicarla, y que el backend siga
sin exponer superficie de revisión (decisión evaluada y descartada en el
mismo PR que agrega este archivo).

Corre FUERA de `backend/tests/`, como `test_e2e_live_workflow.py`: no
necesita Postgres ni fixtures de conftest, solo el archivo y pyyaml.
`.github/workflows/ci.yml:138` corre el directorio entero, así que este
archivo queda cubierto sin tocar `ci.yml`.
"""

from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parents[1]
WORKFLOW = RAIZ / ".github" / "workflows" / "ci.yml"


def cargar():
    """El workflow completo parseado. Falla explícito si todavía no existe."""
    assert WORKFLOW.is_file(), f"falta el workflow: {WORKFLOW}"
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def job_de_imagenes(wf):
    """El job que construye y publica las imágenes de producción.

    Se localiza por `env.IMAGE_TAG == "${{ github.sha }}"` y no por su clave
    de job: si el job se renombra, el candado no debe quedar ciego. Se exige
    que matchee EXACTAMENTE uno para no validar el job equivocado en
    silencio si algún día aparece un segundo `IMAGE_TAG`.
    """
    candidatos = [
        job
        for job in (wf.get("jobs") or {}).values()
        if (job.get("env") or {}).get("IMAGE_TAG") == "${{ github.sha }}"
    ]
    assert len(candidatos) == 1, (
        f"se esperaba exactamente un job con IMAGE_TAG=github.sha, hay {len(candidatos)}"
    )
    return candidatos[0]


def paso_build_frontend(job):
    pasos = [
        p
        for p in job.get("steps", [])
        if "docker/build-push-action" in str(p.get("uses", ""))
        and (p.get("with") or {}).get("context") == "./frontend"
    ]
    assert len(pasos) == 1, f"se esperaba un paso de build del frontend, hay {len(pasos)}"
    return pasos[0]


def paso_build_backend(job):
    pasos = [
        p
        for p in job.get("steps", [])
        if "docker/build-push-action" in str(p.get("uses", ""))
        and (p.get("with") or {}).get("context") == "./backend"
    ]
    assert len(pasos) == 1, f"se esperaba un paso de build del backend, hay {len(pasos)}"
    return pasos[0]


def build_args(paso):
    """`build-args` parseado como líneas `KEY=VALUE`. Vacío si no declara ninguno."""
    crudo = (paso.get("with") or {}).get("build-args", "") or ""
    return dict(
        linea.split("=", 1) for linea in crudo.strip().splitlines() if "=" in linea
    )


def indice_de(job, predicado):
    pasos = job.get("steps", [])
    coincidencias = [i for i, p in enumerate(pasos) if predicado(p)]
    assert coincidencias, "ningún paso matchea el predicado"
    return coincidencias[0]


def test_image_tag_es_el_sha_del_commit_y_no_un_tag_movil():
    """`IMAGE_TAG` tiene que ser un SHA inmutable: si se cambia a un tag móvil
    (p.ej. `latest`), lo que se verifica en CI deja de ser bit a bit lo mismo
    que se publica."""
    job = job_de_imagenes(cargar())
    assert job["env"]["IMAGE_TAG"] == "${{ github.sha }}"


def test_el_build_del_frontend_declara_build_sha():
    """Regresión directa del #927: si el build-arg `BUILD_SHA` desaparece del
    paso "Build frontend image", la imagen vuelve a servir `unknown` en
    producción sin que nada lo detecte hasta el runbook de diagnóstico."""
    job = job_de_imagenes(cargar())
    args = build_args(paso_build_frontend(job))
    assert args.get("BUILD_SHA") == "${{ env.IMAGE_TAG }}"


def test_la_verificacion_de_revision_corre_entre_el_healthy_y_el_login_a_ghcr():
    """Un paso tiene que consultar `/api/health` contra `IMAGE_TAG` DESPUÉS de
    que el stack esté sano y ANTES de autenticar contra GHCR: así una imagen
    que mienta su revisión nunca llega a publicarse."""
    job = job_de_imagenes(cargar())
    pasos = job.get("steps", [])

    def verifica_revision(p):
        corrida = str(p.get("run", ""))
        return "/api/health" in corrida and "IMAGE_TAG" in corrida

    verificaciones = [i for i, p in enumerate(pasos) if verifica_revision(p)]
    assert verificaciones, "ningún paso verifica /api/health contra IMAGE_TAG"

    indice_healthy = indice_de(
        job, lambda p: "Wait until every healthchecked service is healthy" == p.get("name")
    )
    indice_login = indice_de(job, lambda p: "docker/login-action" in str(p.get("uses", "")))

    for i in verificaciones:
        assert i > indice_healthy, "la verificación de revisión corre antes de que el stack esté sano"
        assert i < indice_login, "la verificación de revisión corre después del login a GHCR"


def test_el_build_del_backend_no_declara_build_sha():
    """Decisión deliberada, no un olvido: el backend no expone superficie de
    revisión (Caddy solo publica `/health/ready`) y comparte el mismo
    `IMAGE_TAG` que el frontend. Si alguien le agrega `BUILD_SHA` está
    ensanchando esa superficie, y este candado lo convierte en un diff
    visible en vez de un cambio silencioso."""
    job = job_de_imagenes(cargar())
    args = build_args(paso_build_backend(job))
    assert "BUILD_SHA" not in args
