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


def _renderizar(*archivos_compose: str, perfiles: tuple[str, ...] = ()) -> dict:
    args = ["docker", "compose"]
    for perfil in perfiles:
        args += ["--profile", perfil]
    for archivo in archivos_compose:
        args += ["-f", str(RAIZ / archivo)]
    args += ["config", "--format", "json"]
    resultado = subprocess.run(args, capture_output=True, text=True, cwd=RAIZ)
    assert resultado.returncode == 0, f"docker compose config falló:\n{resultado.stderr}"
    return json.loads(resultado.stdout)


# Perfiles declarados en `docker-compose.yml`. Se activan explícitamente al
# renderizar para que NINGÚN servicio quede fuera de las comprobaciones por el
# simple hecho de estar detrás de un `profiles:` (ver
# `test_el_render_de_produccion_no_publica_ni_un_solo_puerto`).
PERFILES_DECLARADOS = ("test",)


def _config_produccion(*, con_perfiles: bool = False) -> dict:
    return _renderizar(
        "docker-compose.yml",
        "docker-compose.prod.yml",
        perfiles=PERFILES_DECLARADOS if con_perfiles else (),
    )


# Namespace de GHCR del dueño actual del repositorio. La migración de
# propiedad (el repo pasó al namespace propio) dejó las referencias apuntando
# al namespace del equipo anterior: producción seguía tirando de imágenes que
# este repositorio ya no publica ni puede volver a publicar.
NAMESPACE_PROPIO = "ghcr.io/alejandrotatum/"

# Servicios cuya imagen la construye y publica el CI de ESTE repositorio.
# El resto (postgres, redis, mailpit) son imágenes de terceros y no deben
# entrar en esta comprobación.
SERVICIOS_CON_IMAGEN_PROPIA = ("backend", "celery-worker", "celery-beat", "frontend")


def _registro_de(imagen: str) -> str | None:
    """Devuelve el host de registro de una referencia de imagen, o None si la
    referencia no lleva registro explícito (`postgres:16-alpine`,
    `axllent/mailpit:latest` -> Docker Hub)."""
    primer_segmento = imagen.split("/")[0]
    if "/" not in imagen or ("." not in primer_segmento and ":" not in primer_segmento):
        return None
    return primer_segmento


def test_los_servicios_propios_usan_el_namespace_del_dueno_actual():
    """Migración de propiedad: las imágenes se publican bajo el namespace de
    GHCR de este repositorio. Si alguien reintroduce el namespace del equipo
    anterior, producción arranca con imágenes que este repo ya no controla.

    Se exige explícitamente la clave `image:`, para que el test no pase de
    forma vacía si un servicio la pierde (sin `image:` en producción el
    servicio directamente no puede arrancar: `build:` solo vive en el
    override de desarrollo)."""
    config = _config_produccion()
    for nombre in SERVICIOS_CON_IMAGEN_PROPIA:
        servicio = config["services"][nombre]
        assert "image" in servicio, (
            f"'{nombre}' perdió su clave `image:` en el render de producción: "
            f"sin ella no hay nada que desplegar (el `build:` vive solo en el "
            f"override de desarrollo)"
        )
        assert servicio["image"].startswith(NAMESPACE_PROPIO), (
            f"'{nombre}' apunta a '{servicio['image']}', fuera del namespace "
            f"propio '{NAMESPACE_PROPIO}' tras la migración de propiedad"
        )


def test_ningun_servicio_referencia_un_registro_ajeno():
    """Guarda contra un renombrado PARCIAL: basta con que una sola línea se
    quede en el namespace del dueño anterior para que producción despliegue
    una mezcla de imágenes. Recorre TODOS los servicios del render (no una
    lista fija), así que un servicio nuevo queda cubierto automáticamente."""
    config = _config_produccion()
    ajenas = {
        nombre: datos["image"]
        for nombre, datos in config["services"].items()
        if "image" in datos
        and _registro_de(datos["image"]) is not None
        and not datos["image"].startswith(NAMESPACE_PROPIO)
    }
    assert ajenas == {}, (
        f"Estas imágenes viven en un registro/namespace ajeno tras la "
        f"migración de propiedad: {ajenas}"
    )


def test_todos_los_servicios_de_larga_duracion_declaran_healthcheck():
    """`frontend`, `celery-worker` y `celery-beat` nunca reportaban salud:
    Compose los daba por buenos con el proceso arrancado aunque el servidor
    de Next no escuchara, el worker no conectara al broker o beat dejara de
    disparar el schedule. Sin healthcheck, `restart: unless-stopped` solo
    cubre la muerte del proceso, no el cuelgue."""
    config = _config_produccion()
    for nombre in ("frontend", "celery-worker", "celery-beat"):
        healthcheck = config["services"][nombre].get("healthcheck") or {}
        prueba = healthcheck.get("test") or []
        assert prueba, (
            f"'{nombre}' no declara un `healthcheck.test` no vacío en el "
            f"render de producción: {healthcheck}"
        )


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


def test_el_render_de_produccion_no_publica_ni_un_solo_puerto():
    """Recorre TODOS los servicios del render de producción -- no una lista
    fija. La versión anterior de este test comprobaba solo `("db", "redis")` y
    por eso daba por verificada la exposición de puertos mientras `mailpit`
    publicaba en 0.0.0.0 su SMTP (1025) y su UI web SIN autenticación (8025),
    con `SMTP_HOST: ${SMTP_HOST:-mailpit}` mandándole los enlaces de
    recuperación de contraseña. Un servicio nuevo (o un puerto reintroducido
    en la base) queda cubierto automáticamente.

    Los servicios detrás de `profiles:` NO se excluyen: se renderiza con todos
    los perfiles declarados activos (`PERFILES_DECLARADOS`). Que en producción
    nunca arranquen no es excusa para dejarles el puerto en la base -- ahí es
    exactamente donde estaba el agujero. Se comprueban ambos renders (con y
    sin perfiles) para que la garantía no dependa de si una versión concreta
    de Compose materializa o no los servicios con perfil en `config`."""
    for con_perfiles in (False, True):
        config = _config_produccion(con_perfiles=con_perfiles)
        publicadores = {
            nombre: datos["ports"]
            for nombre, datos in config["services"].items()
            if datos.get("ports")
        }
        assert publicadores == {}, (
            f"Estos servicios publican puertos en el host dentro del render de "
            f"producción (perfiles activos={con_perfiles}): {publicadores}. Los "
            f"puertos publicados viven SOLO en `docker-compose.override.yml` "
            f"(decisión de diseño 4.1) -- un overlay de Compose fusiona, nunca "
            f"puede remover una clave, así que `docker-compose.prod.yml` no "
            f"tiene forma de quitarlos."
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
    compose up` sin flags -- el flujo local no debe cambiar. Incluye los
    puertos que se movieron desde la base al override: `mailpit` (1025/8025,
    lo que el desarrollador usa para leer los correos capturados) y `db-test`
    (5436, lo que consume `make test-backend`)."""
    config = _renderizar(
        "docker-compose.yml",
        "docker-compose.override.yml",
        perfiles=PERFILES_DECLARADOS,
    )
    esperados = {
        "db": "5433",
        "db-test": "5436",
        "redis": "6379",
        "backend": "8000",
        "frontend": "3000",
        "mailpit": "8025",
    }
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
