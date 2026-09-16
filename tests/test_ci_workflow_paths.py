"""
Contrato de detección de rutas cambiadas en `ci.yml` (issue #1217).

Los cuatro jobs pesados del workflow (`backend`, `migraciones-desde-cero`,
`frontend`, `docker-images`) corrian en TODOS los PRs sin importar qué tocó el
cambio. Este candado estático verifica que la detección de rutas exista, que
los nombres de los checks requeridos NO cambien (solo se agrega `if`/`needs`),
que el guard de secretos siga incondicional, y que la matriz de rutas cubra
los archivos compartidos reales (los tests raíz corren DENTRO del job
`backend`, asi que `tests/**` tiene que dispararlo).

El evaluador de filtros reproduce la semántica que usa `dorny/paths-filter`
para estos patrones (glob sobre la ruta, un match basta) y se ejercita con
selecciones de rutas representativas — no solo comparando strings.

Corre FUERA de `backend/tests/`: solo necesita el YAML y pyyaml.
`.github/workflows/ci.yml` corre el directorio raíz `tests/` entero, así que
queda cubierto sin tocar `ci.yml` más allá del cambio del issue.
"""

import fnmatch
import re
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[1]
WORKFLOW = RAIZ / ".github" / "workflows" / "ci.yml"

# Nombres de check congelados: la protección de rama los exige por `name`,
# así que renombrarlos rompería los PRs abiertos (issue #1217: no renombrar).
NOMBRES_CONGELADOS = {
    "backend": "Backend (Python)",
    "migraciones-desde-cero": "Migraciones desde DB vacia (empty -> head)",
    "frontend": "Frontend (Node)",
    "docker-images": "Imagenes Docker (build, arranque real y publicacion en GHCR)",
}

JOBS_ESCOPADOS = ("backend", "migraciones-desde-cero", "frontend", "docker-images")


def cargar():
    """El workflow completo parseado. Falla explícito si todavía no existe."""
    assert WORKFLOW.is_file(), f"falta el workflow: {WORKFLOW}"
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def job_de_deteccion(wf):
    """El job detector de rutas, localizado por la acción que usa."""
    for clave, job in (wf.get("jobs") or {}).items():
        for paso in job.get("steps", []):
            if "dorny/paths-filter" in str(paso.get("uses", "")):
                return clave, job
    raise AssertionError("ningún job del workflow usa dorny/paths-filter")


def filtros(wf):
    """Los grupos de globs declarados en la acción, parseados del bloque YAML."""
    _, job = job_de_deteccion(wf)
    paso = next(
        p for p in job["steps"] if "dorny/paths-filter" in str(p.get("uses", ""))
    )
    crudo = (paso.get("with") or {}).get("filters")
    assert isinstance(crudo, str) and crudo.strip(), "filters debe ser un bloque YAML"
    grupos = yaml.safe_load(crudo)
    assert isinstance(grupos, dict) and grupos, "filters debe declarar grupos"
    for nombre, globs in grupos.items():
        assert isinstance(globs, list) and globs, f"grupo {nombre} sin globs"
        assert all(isinstance(g, str) for g in globs), f"grupo {nombre} con globs raros"
    return grupos


def matchea(ruta, globs):
    """Un path matchea un grupo si cualquier glob lo cubre (semántica dorny
    para estos patrones simples: prefijo de directorio + `**`)."""
    return any(fnmatch.fnmatch(ruta, glob) for glob in globs)


def evaluar_condicion(cond, resultados, salidas, push=False):
    """Evalúa la expresión `if` de un job con valores concretos de `needs.*`.

    `resultados`: {job: 'success'|'failure'|'cancelled'|'skipped'};
    `salidas`: outputs del detector ({} si no corrió); `push`: evento push a
    main. Traduce la sintaxis de GitHub Actions a Python y evalúa -- así la
    tabla de verdad se ejercita de verdad, no buscando strings.
    """
    expr = cond.replace("&&", " and ").replace("||", " or ")
    expr = re.sub(
        r"!\s*contains\(needs\.\*\.result,\s*'(\w+)'\)",
        lambda m: f"{m.group(1)!r} not in resultados_valores",
        expr,
    )
    expr = re.sub(
        r"contains\(needs\.\*\.result,\s*'(\w+)'\)",
        lambda m: f"{m.group(1)!r} in resultados_valores",
        expr,
    )
    expr = expr.replace("always()", "True")
    expr = expr.replace("github.event_name == 'push'", str(push))
    expr = re.sub(
        r"needs\.[\w-]+\.outputs\.(\w+)\s*!=\s*'\w+'",
        lambda m: str(salidas.get(m.group(1)) != "false"),
        expr,
    )
    expr = re.sub(
        r"needs\.([\w-]+)\.result\s*!=\s*'(\w+)'",
        lambda m: str(resultados.get(m.group(1)) != m.group(2)),
        expr,
    )
    expr = re.sub(
        r"needs\.([\w-]+)\.result\s*==\s*'(\w+)'",
        lambda m: str(resultados.get(m.group(1)) == m.group(2)),
        expr,
    )
    return bool(eval(expr, {"resultados_valores": tuple(resultados.values())}))


def condi_de(wf, clave):
    return (wf.get("jobs") or {})[clave].get("if") or ""


def matriz(wf, rutas):
    """Qué grupos dispararía un conjunto de rutas cambiadas."""
    grupos = filtros(wf)
    return {
        nombre: any(matchea(r, globs) for r in rutas)
        for nombre, globs in grupos.items()
    }


# ─── Estructura general ───────────────────────────────────────────────────────


def test_los_nombres_de_los_checks_requeridos_no_cambian():
    """Regresión directa del enunciado: el escoping es solo condición de
    ejecución; los `name:` que exige la protección de rama quedan intactos."""
    wf = cargar()
    jobs = wf.get("jobs") or {}
    for clave, nombre in NOMBRES_CONGELADOS.items():
        assert jobs.get(clave, {}).get("name") == nombre, (
            f"el job {clave} cambió su name: rompería los checks requeridos"
        )


def test_sin_filtros_de_rutas_a_nivel_de_workflow():
    """El filtro tiene que ser por condición de job, NO por `paths:` en `on:`:
    un filtro de workflow haría que pushes a main sin rutas relevantes no
    dispararan CI nunca (y los checks requeridos quedarían pending)."""
    # PyYAML parsea la clave `on:` como booleano True.
    disparadores = cargar().get(True) or cargar().get("on")
    for clave in ("push", "pull_request"):
        assert clave in disparadores, f"falta el disparador {clave}"  # puede ser null
        assert "paths" not in (disparadores.get(clave) or {}), (
            f"{clave} no debe filtrar por paths a nivel de workflow"
        )
        assert "paths-ignore" not in (disparadores.get(clave) or {}), (
            f"{clave} no debe filtrar por paths-ignore a nivel de workflow"
        )


def test_el_guard_de_secretos_sigue_incondicional():
    """El guard de secretos no entra en el escoping: corre siempre, antes de
    todo, sin `needs` ni `if`."""
    guard = (cargar().get("jobs") or {}).get("guard-secretos")
    assert guard is not None, "falta guard-secretos"
    assert not guard.get("needs"), "guard-secretos no debe depender del detector"
    assert "if" not in guard, "guard-secretos no debe condicionarse por rutas"


def test_el_detector_usa_la_accion_pineada_por_sha():
    """Acción de terceros pineada al SHA del commit (misma práctica que
    setup-uv y setup-buildx) y con permisos mínimos de solo lectura."""
    _, job = job_de_deteccion(cargar())
    usos = [p["uses"] for p in job["steps"] if "dorny/paths-filter" in str(p.get("uses", ""))]
    assert len(usos) == 1, "debe haber exactamente un paso detector"
    uso = usos[0]
    assert "@" in uso, "la acción debe estar pineada"
    ref = uso.split("@", 1)[1].split("#")[0].strip()
    assert len(ref) == 40 and all(c in "0123456789abcdef" for c in ref), (
        f"la ref debe ser un SHA de commit completo, es: {ref}"
    )
    permisos = job.get("permissions") or {}
    assert permisos.get("contents") == "read", "el detector solo necesita leer"
    assert "packages" not in permisos, "el detector no toca GHCR"


# ─── Condiciones de los jobs escopados ────────────────────────────────────────


def test_el_detector_expone_un_output_por_grupo():
    """Regresión B1: sin `outputs:` en el job detector, `needs.cambios.outputs.*
    es siempre vacío y TODOS los jobs pesados se saltan en cada PR."""
    wf = cargar()
    clave, job = job_de_deteccion(wf)
    salidas = job.get("outputs") or {}
    for grupo in filtros(wf):
        assert salidas.get(grupo) == "${{ steps.rutas.outputs.%s }}" % grupo, (
            f"el job {clave} no expone el output del grupo {grupo}"
        )


def test_el_detector_declara_pull_requests_read():
    """Regresión B2: la doc oficial de dorny/paths-filter exige
    `pull-requests: read` para resolver la base de un PR."""
    _, job = job_de_deteccion(cargar())
    permisos = job.get("permissions") or {}
    assert permisos.get("pull-requests") == "read", (
        "al detector le falta pull-requests: read"
    )


def test_ningun_job_exige_el_exito_del_detector_para_decidir():
    """Regresión B3: exigir `needs.cambios.result == 'success'` SKIPPEA los
    checks requeridos si el detector falla -- un skip no pone el check en rojo
    y la protección de rama queda insatisfecha. El criterio es fail-open: si
    el detector no corrió bien, los jobs pesados corren COMPLETOS (validación
    conservadora), nunca un salto silencioso."""
    wf = cargar()
    for clave in JOBS_ESCOPADOS:
        cond = condi_de(wf, clave)
        assert "needs.cambios.result == 'success'" not in cond, (
            f"{clave} saltearía los checks requeridos si el detector falla"
        )


# ─── Tabla de verdad de las condiciones (escenarios evento/dependencia) ──────


def _escenarios():
    """(nombre, resultados de needs, outputs del detector, push,
    esperado_backend/migraciones, esperado_frontend)."""
    return [
        ("pr backend-only", {"guard-secretos": "success", "cambios": "success"}, {"backend": "true", "frontend": "false", "docker": "true"}, False, True, False),
        ("pr frontend-only", {"guard-secretos": "success", "cambios": "success"}, {"backend": "false", "frontend": "true", "docker": "true"}, False, False, True),
        ("pr docs-only", {"guard-secretos": "success", "cambios": "success"}, {"backend": "false", "frontend": "false", "docker": "false"}, False, False, False),
        ("pr detector falla", {"guard-secretos": "success", "cambios": "failure"}, {}, False, True, True),
        ("pr detector cancelado", {"guard-secretos": "success", "cambios": "cancelled"}, {}, False, True, True),
        ("pr detector ok sin outputs", {"guard-secretos": "success", "cambios": "success"}, {}, False, True, True),
        ("push main detector saltado", {"guard-secretos": "success", "cambios": "skipped"}, {}, True, True, True),
        ("pr guard fallo", {"guard-secretos": "failure", "cambios": "success"}, {"backend": "true"}, False, False, False),
    ]


@pytest.mark.parametrize("nombre,resultados,salidas,push,esperado,_", _escenarios())
def test_tabla_de_verdad_backend(nombre, resultados, salidas, push, esperado, _):
    """Backend corre ante su grupo, ante detector roto/desconocido y en push a
    main; NUNCA con el guard en rojo."""
    assert evaluar_condicion(condi_de(cargar(), "backend"), resultados, salidas, push) is esperado, nombre


@pytest.mark.parametrize("nombre,resultados,salidas,push,esperado,_", _escenarios())
def test_tabla_de_verdad_migraciones(nombre, resultados, salidas, push, esperado, _):
    assert evaluar_condicion(condi_de(cargar(), "migraciones-desde-cero"), resultados, salidas, push) is esperado, nombre


@pytest.mark.parametrize("nombre,resultados,salidas,push,_,esperado_frontend", _escenarios())
def test_tabla_de_verdad_frontend(nombre, resultados, salidas, push, _, esperado_frontend):
    assert evaluar_condicion(condi_de(cargar(), "frontend"), resultados, salidas, push) is esperado_frontend, nombre


def test_docker_bloquea_fallas_y_corre_para_ambas_imagenes():
    """El job de imágenes: corre ante cambios de cualquiera de las dos imágenes
    (saltarlo en frontend-only fue rechazado como insano), se bloquea si un
    upstream falló o se canceló (candado #552), y hace fail-open si el
    detector no corrió."""
    wf = cargar()
    cond = condi_de(wf, "docker-images")
    base = {"guard-secretos": "success", "backend": "success", "frontend": "success", "migraciones-desde-cero": "success", "cambios": "success"}
    # Frontend-only con upstreams verdes: corre.
    assert evaluar_condicion(cond, base, {"docker": "true"}) is True
    # Output ausente con detector exitoso (config rota): fail-open.
    assert evaluar_condicion(cond, base, {}) is True
    # Backend falló aunque los paths matcheen: BLOQUEA.
    assert evaluar_condicion(cond, {**base, "backend": "failure"}, {"docker": "true"}) is False
    # Upstream cancelado: bloquea.
    assert evaluar_condicion(cond, {**base, "frontend": "cancelled"}, {"docker": "true"}) is False
    # Upstream SALTADO (p.ej. docs-only): habilita si el grupo docker matchea.
    saltados = {**base, "backend": "skipped", "frontend": "skipped", "migraciones-desde-cero": "skipped"}
    assert evaluar_condicion(cond, saltados, {"docker": "false"}) is False
    assert evaluar_condicion(cond, saltados, {"docker": "true"}) is True
    # Detector falla: fail-open; en ese caso los otros jobs pesados también
    # corren (misma política), así que el escenario realista es upstreams
    # exitosos y docker corre igual con outputs vacíos.
    assert evaluar_condicion(cond, {"guard-secretos": "success", "backend": "success", "frontend": "success", "migraciones-desde-cero": "success", "cambios": "failure"}, {}) is True
    # Guard en rojo: jamás corre.
    assert evaluar_condicion(cond, {**saltados, "guard-secretos": "failure"}, {"docker": "true"}) is False
    # Push a main con detector saltado: corre siempre.
    assert evaluar_condicion(cond, {**base, "cambios": "skipped"}, {}, push=True) is True


# ─── Matriz de rutas (escenarios representativos) ─────────────────────────────


def test_frontend_solo_skippea_backend_y_migraciones_pero_no_docker():
    resultado = matriz(cargar(), ["frontend/src/components/PagoCard.tsx"])
    assert resultado["frontend"] is True
    assert resultado["backend"] is False
    assert resultado["docker"] is True, (
        "un cambio de frontend afecta la imagen frontend: docker corre"
    )


def test_backend_solo_skippea_frontend():
    resultado = matriz(cargar(), ["backend/app/servicios_negocio/pagos.py"])
    assert resultado["backend"] is True
    assert resultado["frontend"] is False
    assert resultado["docker"] is True


def test_tests_raiz_disparan_backend_y_docker():
    """Los tests de `tests/` (raíz) corren DENTRO del job backend, así que un
    cambio ahí tiene que dispararlo; docker también, por consistencia
    conservadora con el stack que esos tests validan."""
    resultado = matriz(cargar(), ["tests/test_ci_workflow_paths.py"])
    assert resultado["backend"] is True
    assert resultado["docker"] is True
    assert resultado["frontend"] is False


def test_los_archivos_compartidos_disparan_todos_los_grupos():
    """Regresión B4: Makefile, los docker-compose y este workflow son entrada
    de TODOS los lados (lanes locales, tests raíz, stack de imágenes), así que
    disparan backend, frontend Y docker -- no solo al que los consume."""
    compartidos = ["Makefile", "docker-compose.yml", "docker-compose.prod.yml",
                   "docker-compose.qa.yml", "docker-compose.override.yml",
                   ".github/workflows/ci.yml"]
    for ruta in compartidos:
        resultado = matriz(cargar(), [ruta])
        assert resultado["backend"] and resultado["frontend"] and resultado["docker"], (
            f"{ruta} debe disparar los tres grupos, disparó {resultado}"
        )


def test_caddyfile_dispara_solo_docker():
    """El Caddyfile es entrada exclusiva del stack de imágenes."""
    resultado = matriz(cargar(), ["Caddyfile"])
    assert resultado == {"backend": False, "frontend": False, "docker": True}


def test_documentacion_sola_corre_ningun_job_pesado():
    resultado = matriz(cargar(), ["README.md", "docs/operations/monitoring.md"])
    assert not any(resultado.values()), (
        "cambios solo de documentación no deben disparar jobs pesados"
    )


def test_el_grupo_docker_cubre_ambos_contextos_de_build():
    """`docker-images` construye ./backend y ./frontend: su grupo debe cubrir
    los globs de backend y frontend (los archivos compartidos entran por la
    regla de B4)."""
    grupos = filtros(cargar())
    docker = grupos["docker"]
    for contexto in ("backend", "frontend"):
        for glob in grupos[contexto]:
            assert glob in docker, (
                f"docker no cubre {glob} del grupo {contexto}: "
                f"un cambio ahí saltaría el build de imagen que lo consume"
            )
