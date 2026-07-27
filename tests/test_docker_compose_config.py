"""
Verifica que la capa de producción del compose (`docker-compose.yml` +
`docker-compose.prod.yml`) es ESTRUCTURALMENTE incapaz de construir
imágenes ni de publicar los puertos de datos (decisión de diseño 4.1,
sdd/production-readiness, PR-14): `build:` y los `ports:` publicados viven
únicamente en `docker-compose.override.yml`, que NUNCA se aplica junto con
el overlay de producción.

Corre FUERA de la suite de pytest de `backend/` a propósito: no requiere
Postgres, `TEST_DATABASE_URL`, ni ningún fixture de
`backend/tests/conftest.py` -- solo Docker Compose. Invocar con, por
ejemplo: `cd backend && uv run pytest ../tests/test_docker_compose_config.py`
(ver `make test-compose`).
"""
import json
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def _renderizar(*archivos_compose: str) -> dict:
    args = ["docker", "compose"]
    for archivo in archivos_compose:
        args += ["-f", str(RAIZ / archivo)]
    args += ["config", "--format", "json"]
    resultado = subprocess.run(args, capture_output=True, text=True, cwd=RAIZ)
    assert resultado.returncode == 0, f"docker compose config falló:\n{resultado.stderr}"
    return json.loads(resultado.stdout)


def _config_produccion() -> dict:
    return _renderizar("docker-compose.yml", "docker-compose.prod.yml")


def test_overlay_de_produccion_no_declara_ninguna_clave_build():
    config = _config_produccion()
    servicios_con_build = [
        nombre for nombre, datos in config["services"].items() if "build" in datos
    ]
    assert servicios_con_build == [], (
        f"Estos servicios tienen `build:` en el overlay de producción -- "
        f"construir en el droplet es justo lo que mide el OOM en 2GB: "
        f"{servicios_con_build}"
    )


def test_overlay_de_produccion_no_publica_puertos_de_db_ni_redis():
    config = _config_produccion()
    for nombre in ("db", "redis"):
        puertos = config["services"][nombre].get("ports", [])
        assert puertos == [], (
            f"El servicio '{nombre}' publica puertos en el overlay de "
            f"producción: {puertos}"
        )


def test_celery_worker_declara_concurrencia_explicita():
    """Sin `--concurrency` fijo, prefork genera un proceso hijo por core del
    host -- 745MB medidos en un host de 12 cores (decisión de diseño 4.6)."""
    config = _config_produccion()
    comando = config["services"]["celery-worker"].get("command") or []
    comando_texto = comando if isinstance(comando, str) else " ".join(comando)
    assert "--concurrency" in comando_texto


def test_override_de_desarrollo_sigue_publicando_los_mismos_puertos():
    """Regresión: `docker-compose.override.yml` se auto-carga con `docker
    compose up` sin flags -- el flujo local no debe cambiar."""
    config = _renderizar("docker-compose.yml", "docker-compose.override.yml")
    esperados = {"db": "5433", "redis": "6379", "backend": "8000", "frontend": "3000"}
    for servicio, puerto_esperado in esperados.items():
        publicados = {p["published"] for p in config["services"][servicio].get("ports", [])}
        assert puerto_esperado in publicados, (
            f"'{servicio}' ya no publica el puerto {puerto_esperado} en el "
            f"override de desarrollo"
        )


def test_override_de_desarrollo_sigue_construyendo_las_imagenes_localmente():
    """Regresión: `docker compose build`/`up --build` en desarrollo debe
    seguir funcionando sin flags adicionales."""
    config = _renderizar("docker-compose.yml", "docker-compose.override.yml")
    for servicio in ("backend", "celery-worker", "celery-beat", "frontend"):
        assert "build" in config["services"][servicio], (
            f"'{servicio}' perdió su `build:` en el override de desarrollo"
        )
