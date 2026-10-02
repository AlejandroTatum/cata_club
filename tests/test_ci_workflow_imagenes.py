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
        and any((p.get("with") or {}).get("load") is True for p in job.get("steps", []))
    ]
    assert len(candidatos) == 1, (
        f"se esperaba exactamente un job de verificación con IMAGE_TAG=github.sha, hay {len(candidatos)}"
    )
    return candidatos[0]


def job_de_publicacion(wf):
    """El job que publica a GHCR (el único con `docker/login-action`)."""
    candidatos = [
        job
        for job in (wf.get("jobs") or {}).values()
        if any("docker/login-action" in str(p.get("uses", "")) for p in job.get("steps", []))
    ]
    assert len(candidatos) == 1, f"se esperaba un único job que haga login a GHCR, hay {len(candidatos)}"
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


def test_la_verificacion_de_revision_corre_despues_del_healthy():
    """Un paso tiene que consultar `/api/health` contra `IMAGE_TAG` DESPUÉS de
    que el stack esté sano. La publicación vive en otro job que exige este."""
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
    for i in verificaciones:
        assert i > indice_healthy, "la verificación de revisión corre antes de que el stack esté sano"


def test_docker_images_no_publica_ni_espera_a_los_jobs_de_tests():
    """Fuera del camino crítico de los PRs: el job de verificación no depende
    de backend/frontend/migraciones y no tiene ningún paso de GHCR."""
    job = job_de_imagenes(cargar())
    assert set(job["needs"]) == {"guard-secretos", "cambios"}
    assert "packages" not in (job.get("permissions") or {})
    for p in job.get("steps", []):
        assert "docker/login-action" not in str(p.get("uses", ""))
        assert "docker push" not in str(p.get("run", ""))
        assert (p.get("with") or {}).get("push") is not True


def test_publicacion_exige_todos_los_gates_y_solo_corre_en_push_a_main():
    """Candado #552: GHCR solo recibe imágenes de un run donde backend,
    frontend, migraciones y la verificación de imágenes terminaron en success."""
    wf = cargar()
    job = job_de_publicacion(wf)
    assert set(job["needs"]) == {
        "guard-secretos", "backend", "frontend", "migraciones-desde-cero", "docker-images",
    }
    cond = job["if"]
    assert "github.event_name == 'push'" in cond
    assert "github.ref == 'refs/heads/main'" in cond
    for necesario in job["needs"]:
        assert f"needs.{necesario}.result == 'success'" in cond, necesario
    assert (job.get("permissions") or {}).get("packages") == "write"


def test_publicacion_empuja_las_imagenes_verificadas_sin_reconstruir():
    job = job_de_publicacion(cargar())
    pasos = job["steps"]
    assert not any("docker/build-push-action" in str(p.get("uses", "")) for p in pasos)
    assert any("actions/download-artifact" in str(p.get("uses", "")) for p in pasos)
    corridas = "\n".join(str(p.get("run", "")) for p in pasos)
    assert "docker load" in corridas
    assert '"$IMAGEN_BACKEND" "$IMAGEN_FRONTEND"' in corridas
    assert 'docker push "$IMG:$IMAGE_TAG"' in corridas
    assert 'docker push "$IMG:latest"' in corridas


def test_docker_images_guarda_y_sube_las_imagenes_verificadas_solo_en_push_a_main():
    pasos = job_de_imagenes(cargar())["steps"]
    guardar = next(p for p in pasos if "docker save" in str(p.get("run", "")))
    subir = next(p for p in pasos if "actions/upload-artifact" in str(p.get("uses", "")))
    for p in (guardar, subir):
        assert "github.event_name == 'push'" in p["if"]
        assert "github.ref == 'refs/heads/main'" in p["if"]
    assert subir["with"]["retention-days"] == 1


def test_todos_los_jobs_declaran_timeout_minutes():
    jobs = cargar()["jobs"]
    esperados = {
        "cambios": 5, "guard-secretos": 5, "backend": 40,
        "migraciones-desde-cero": 10, "frontend": 25, "docker-images": 20,
    }
    for clave, job in jobs.items():
        assert isinstance(job.get("timeout-minutes"), int), f"{clave} sin timeout-minutes"
    for clave, minutos in esperados.items():
        assert jobs[clave]["timeout-minutes"] == minutos, clave


def test_backend_reporta_las_pruebas_mas_lentas():
    pasos = cargar()["jobs"]["backend"]["steps"]
    corrida = next(p["run"] for p in pasos if p.get("name") == "Run tests")
    assert "--durations=25" in corrida


def test_el_build_del_backend_no_declara_build_sha():
    """Decisión deliberada, no un olvido: el backend no expone superficie de
    revisión (Caddy solo publica `/health/ready`) y comparte el mismo
    `IMAGE_TAG` que el frontend. Si alguien le agrega `BUILD_SHA` está
    ensanchando esa superficie, y este candado lo convierte en un diff
    visible en vez de un cambio silencioso."""
    job = job_de_imagenes(cargar())
    args = build_args(paso_build_backend(job))
    assert "BUILD_SHA" not in args
