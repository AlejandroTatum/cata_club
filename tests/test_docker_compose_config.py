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
import os
import re
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent

# Clave arbitraria pero válida, usada SOLO para renderizar el compose en esta
# suite. `docker-compose.yml` declara `${JWT_SECRET_KEY:?...}` y esa
# interpolación ocurre al cargar CADA archivo, antes de fusionarlos: sin un
# valor, `docker compose config` aborta y estas pruebas exigían un `.env` en la
# raíz que ningún clon limpio (ni ningún worktree recién creado) trae. Ninguna
# aserción depende del valor; solo de que exista.
_JWT_PARA_RENDER = "0" * 64

# Mismo patrón que `_JWT_PARA_RENDER`: desde que `docker-compose.prod.yml`
# declara `${CORS_ORIGENES:?...}` (ver
# test_el_overlay_de_produccion_exige_cors_origenes), CUALQUIER render de
# producción que no fije la variable aborta -- incluidos los que no prueban
# nada relacionado con CORS. Ningún assert de este archivo depende del
# valor; solo de que exista.
_CORS_PARA_RENDER = "http://localhost-para-tests.invalid"

# Mismo patrón, para `DOMINIO` y `ACME_EMAIL` (`${DOMINIO:?...}` /
# `${ACME_EMAIL:?...}` en el servicio `caddy` de `docker-compose.prod.yml`):
# cualquier render de producción que no fije estas variables aborta, así
# que hace falta un valor centinela en TODA renderización de este archivo,
# no solo en los tests que prueban el ingress.
_DOMINIO_PARA_RENDER = "ejemplo-para-tests.invalid"
_ACME_EMAIL_PARA_RENDER = "acme-tests@ejemplo.invalid"


def _ejecutar_config(
    *archivos_compose: str,
    perfiles: tuple[str, ...] = (),
    entorno: dict[str, str] | None = None,
    omitir: tuple[str, ...] = (),
) -> subprocess.CompletedProcess:
    args = ["docker", "compose"]
    for perfil in perfiles:
        args += ["--profile", perfil]
    for archivo in archivos_compose:
        args += ["-f", str(RAIZ / archivo)]
    args += ["config", "--format", "json"]
    entorno_final = {
        "JWT_SECRET_KEY": _JWT_PARA_RENDER,
        "CORS_ORIGENES": _CORS_PARA_RENDER,
        "DOMINIO": _DOMINIO_PARA_RENDER,
        "ACME_EMAIL": _ACME_EMAIL_PARA_RENDER,
        **os.environ,
        **(entorno or {}),
    }
    for variable in omitir:
        entorno_final.pop(variable, None)
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=RAIZ,
        env=entorno_final,
    )


def _renderizar(
    *archivos_compose: str,
    perfiles: tuple[str, ...] = (),
    entorno: dict[str, str] | None = None,
) -> dict:
    resultado = _ejecutar_config(*archivos_compose, perfiles=perfiles, entorno=entorno)
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


# ─── Guarda de centinela: valores del operador llegan al contenedor ────────
#
# `docker compose config` RESUELVE la interpolación -- el valor final es
# indistinguible entre `${CORS_ORIGENES:-http://localhost:3000}` y un
# literal fijo `http://localhost:3000`. La única forma de probar que una
# variable es de verdad interpolada es inyectar un valor único (un
# "centinela") por la exportación del operador y comprobar que ESE valor,
# y no otro, aparece en el render fusionado. Si una variable está
# hardcodeada en el compose, ningún validador de `Settings` puede verla
# nunca, sin importar cuán estricto sea (ver Decisión de diseño 2,
# sdd/production-config-contract).
SERVICIOS_PYTHON_DE_PRODUCCION = ("backend", "celery-worker", "celery-beat")

# Variable tal como la resuelve el contenedor -> variables que exporta el
# operador y que deben terminar DENTRO de ese valor. Casi siempre son la
# misma; `DATABASE_URL` se compone de las tres `POSTGRES_*` (el host es el
# servicio `db`, fijo a propósito: la base vive en la misma pila).
_VARIABLES_CRITICAS_DE_PRODUCCION: dict[str, tuple[str, ...]] = {
    "JWT_SECRET_KEY": ("JWT_SECRET_KEY",),
    "CORS_ORIGENES": ("CORS_ORIGENES",),
    "SMTP_HOST": ("SMTP_HOST",),
    "FRONTEND_URL": ("FRONTEND_URL",),
    "DATABASE_URL": ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"),
    "CLOUDINARY_CLOUD_NAME": ("CLOUDINARY_CLOUD_NAME",),
    "CLOUDINARY_API_KEY": ("CLOUDINARY_API_KEY",),
    "CLOUDINARY_API_SECRET": ("CLOUDINARY_API_SECRET",),
}

# Un centinela por variable exportable por el operador, único para que una
# variable jamás pueda "aprobar por accidente" leyendo el centinela de otra.
_SENTINELAS_POR_VARIABLE_OPERADOR: dict[str, str] = {
    operador: f"centinela-{operador.lower()}-9f3a7c"
    for variables in _VARIABLES_CRITICAS_DE_PRODUCCION.values()
    for operador in variables
}

# Todas las combinaciones (servicio, variable_renderizada, variable_operador)
# a comprobar. `DATABASE_URL` aporta 3 combinaciones por servicio (una por
# cada `POSTGRES_*` que la compone); el resto aporta 1. Se listan explícitas
# -- no se colapsan en una sola aserción por variable -- para que un fallo
# señale exactamente qué combinación no llegó, en vez de un mensaje agregado.
_CASOS_CENTINELA = [
    (servicio, variable_renderizada, operador)
    for servicio in SERVICIOS_PYTHON_DE_PRODUCCION
    for variable_renderizada, operadores in _VARIABLES_CRITICAS_DE_PRODUCCION.items()
    for operador in operadores
]


@pytest.fixture(scope="module")
def _config_produccion_con_centinelas() -> dict:
    return _renderizar(
        "docker-compose.yml",
        "docker-compose.prod.yml",
        entorno=dict(_SENTINELAS_POR_VARIABLE_OPERADOR),
    )


@pytest.mark.parametrize(
    "servicio,variable_renderizada,operador",
    _CASOS_CENTINELA,
    ids=[f"{s}-{v}-{o}" for s, v, o in _CASOS_CENTINELA],
)
def test_las_variables_criticas_llegan_al_contenedor_en_el_render_de_produccion(
    _config_produccion_con_centinelas, servicio, variable_renderizada, operador
):
    valor_renderizado = str(
        _config_produccion_con_centinelas["services"][servicio]["environment"].get(
            variable_renderizada, ""
        )
    )
    centinela = _SENTINELAS_POR_VARIABLE_OPERADOR[operador]
    assert centinela in valor_renderizado, (
        f"'{servicio}.{variable_renderizada}' no refleja el valor que exportó "
        f"el operador para {operador}: el render devolvió "
        f"{valor_renderizado!r}, sin el centinela {centinela!r}. Esta "
        f"variable está hardcodeada en el compose de producción -- ningún "
        f"validador de `Settings` puede verla nunca. Arreglo: usar "
        f"`${{{operador}}}` o `${{{operador}:?mensaje}}` en el overlay de "
        f"producción, o `${{{operador}:-default}}` en la base."
    )


def test_el_overlay_de_produccion_exige_cors_origenes():
    """`CORS_ORIGENES` no puede caer al default de desarrollo en producción:
    un despliegue real que se olvide de exportarlo terminaría sirviendo con
    el origen `http://localhost:3000`, que ningún navegador real usa -- el
    frontend legítimo quedaría bloqueado por CORS en silencio. El overlay de
    producción tiene que EXIGIR la variable (`${CORS_ORIGENES:?...}`), no
    solo aceptarla."""
    resultado = _ejecutar_config(
        "docker-compose.yml",
        "docker-compose.prod.yml",
        omitir=("CORS_ORIGENES",),
    )
    assert resultado.returncode != 0, (
        "el render de producción tiene que fallar sin CORS_ORIGENES -- en "
        "cambio completó con éxito, lo que significa que la variable sigue "
        "teniendo un default utilizable en producción"
    )
    assert "CORS_ORIGENES" in resultado.stderr, (
        f"el render falló, pero el mensaje no menciona CORS_ORIGENES -- no es "
        f"accionable para quien despliega: {resultado.stderr!r}"
    )


def test_produccion_activa_starttls_en_los_servicios_python():
    """`docker-compose.yml` deja `SMTP_STARTTLS` en `false` para que mailpit
    (SMTP sin TLS) siga funcionando en desarrollo. Producción no tiene ese
    catcher local: sin STARTTLS el correo transaccional (incluidos los
    enlaces de recuperación de contraseña) viaja en texto plano hacia
    cualquier proveedor SMTP real. El overlay de producción tiene que
    defaultear a `true`, sin perder la posibilidad de que el operador lo
    desactive explícitamente."""
    resultado = _ejecutar_config(
        "docker-compose.yml",
        "docker-compose.prod.yml",
        omitir=("SMTP_STARTTLS",),
    )
    assert resultado.returncode == 0, f"docker compose config falló:\n{resultado.stderr}"
    config = json.loads(resultado.stdout)
    for servicio in SERVICIOS_PYTHON_DE_PRODUCCION:
        valor = config["services"][servicio]["environment"].get("SMTP_STARTTLS")
        assert str(valor).lower() == "true", (
            f"'{servicio}.SMTP_STARTTLS' resolvió a {valor!r} en el render de "
            f"producción sin que el operador lo fije -- el overlay de "
            f"producción tiene que defaultear a 'true'"
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
    cubre la muerte del proceso, no el cuelgue.

    Recorre TODOS los servicios del render en vez de la terna fija que
    comprobaba la versión anterior. Esa lista dejaba fuera justo a los dos
    servicios cuyo healthcheck se rompió después: `caddy` -- el único borde
    público -- y `backend`. Con la lista fija, borrar cualquiera de esos dos
    healthchecks dejaba la suite entera en verde, y
    `test_ningun_healthcheck_de_produccion_sondea_localhost` tampoco lo
    veía: ese candado exige que ninguna sonda diga `localhost`, y un
    servicio sin sonda cumple esa condición sin problema. Uno canda el
    negativo y este el positivo; hacen falta los dos.

    Se comprueban ambos renders, con y sin perfiles, igual que los demás
    candados que recorren servicios en este archivo: los servicios detrás
    de `profiles:` tampoco tienen excusa para no reportar salud."""
    for con_perfiles in (False, True):
        config = _config_produccion(con_perfiles=con_perfiles)
        sin_salud = {
            nombre: (datos.get("healthcheck") or {})
            for nombre, datos in config["services"].items()
            if not (datos.get("healthcheck") or {}).get("test")
        }
        assert sin_salud == {}, (
            f"Estos servicios no declaran un `healthcheck.test` no vacío en "
            f"el render de producción (perfiles activos={con_perfiles}): "
            f"{sin_salud}. Sin healthcheck, Compose da el servicio por bueno "
            f"con el proceso arrancado aunque esté colgado, y "
            f"`restart: unless-stopped` no lo levanta."
        )


def test_ningun_healthcheck_de_produccion_sondea_localhost():
    """`localhost` dentro de un contenedor NO es un sinónimo de `127.0.0.1`:
    resuelve a `::1` y a `127.0.0.1`, y el `wget` de BusyBox prueba `::1`
    primero. Un proceso Go que bindea `localhost:PUERTO` (Caddy y su admin
    endpoint, entre otros) escucha en UNA sola de esas direcciones -- la IPv4
    --, así que el sondeo recibe `Connection refused` en cada intento y el
    servicio queda `unhealthy` para siempre.

    Eso hundió el job "Imagenes Docker" del CI: el healthcheck de `caddy`
    apuntaba a `http://localhost:2019/config/`, el contenedor nunca llegó a
    `healthy` y el workflow murió por timeout a los 7 minutos. El log del
    contenedor no ayudaba -- Caddy arrancaba perfecto y sus errores de ACME
    (esperados con un dominio de CI inválido) parecían la causa sin serlo.

    Este candado recorre TODOS los servicios del render, no una lista fija:
    el error es invisible leyendo el YAML y solo se manifiesta dentro del
    contenedor, así que el próximo healthcheck que se agregue tiene que
    nacer cubierto."""
    for con_perfiles in (False, True):
        config = _config_produccion(con_perfiles=con_perfiles)
        culpables = {
            nombre: prueba
            for nombre, datos in config["services"].items()
            if (prueba := (datos.get("healthcheck") or {}).get("test"))
            and "localhost" in " ".join(prueba if isinstance(prueba, list) else [prueba])
        }
        assert culpables == {}, (
            f"Estos healthchecks sondean `localhost` (perfiles "
            f"activos={con_perfiles}): {culpables}. Usá `127.0.0.1`: el "
            f"cliente puede intentar `::1` primero y encontrar el puerto "
            f"cerrado aunque el proceso esté sano."
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


def test_el_render_de_produccion_solo_caddy_publica_puertos_y_son_80_443():
    """Reemplaza a la versión anterior de este test (que exigía CERO puertos
    publicados): con el ingress (`caddy`) sumado en esta PR, esa asunción dejó
    de ser cierta a propósito -- `caddy` es la única puerta pública del stack.
    El backend NUNCA se expone: lo consume el frontend por la red interna de
    Docker (decisión de arquitectura ya verificada), así que este test sigue
    siendo el guardado que evita que alguien publique el puerto del backend
    (o de cualquier otro servicio) más adelante sin darse cuenta.

    Recorre TODOS los servicios del render -- no una lista fija -- igual que
    la versión anterior: la razón sigue viva, `mailpit` publicaba puertos sin
    que ningún test cubriera más que `("db", "redis")`. Se comprueban ambos
    renders (con y sin perfiles) por la misma razón que antes."""
    for con_perfiles in (False, True):
        config = _config_produccion(con_perfiles=con_perfiles)
        publicadores = {
            nombre: datos["ports"]
            for nombre, datos in config["services"].items()
            if datos.get("ports")
        }
        assert set(publicadores) == {"caddy"}, (
            f"El único servicio con puertos publicados en producción debe ser "
            f"'caddy' (perfiles activos={con_perfiles}), y se encontró: "
            f"{publicadores}. Los puertos publicados de servicios de "
            f"desarrollo viven SOLO en `docker-compose.override.yml` -- un "
            f"overlay de Compose fusiona, nunca puede remover una clave, así "
            f"que `docker-compose.prod.yml` no tiene forma de quitarlos."
        )
        puertos_publicados = {p["published"] for p in publicadores["caddy"]}
        assert puertos_publicados == {"80", "443"}, (
            f"'caddy' debe publicar exactamente 80 y 443 (perfiles "
            f"activos={con_perfiles}), y publica {puertos_publicados}"
        )


# ─── Ingress (Caddy) y rotación de logs ──────────────────────────────────


def test_todos_los_servicios_de_produccion_declaran_logging_acotado():
    """Sin rotación, `json-file` (el driver por defecto de Docker) escribe
    logs sin límite: el disco de 50GB del droplet se llena en silencio, y
    Postgres es el primer servicio en morir sin espacio (no puede escribir
    WAL). Cada servicio del render -- incluido `caddy` -- tiene que declarar
    `max-size` y `max-file` no vacíos."""
    config = _config_produccion()
    for nombre, datos in config["services"].items():
        logging_cfg = datos.get("logging") or {}
        opciones = logging_cfg.get("options") or {}
        assert logging_cfg.get("driver") == "json-file", (
            f"'{nombre}' no declara `logging.driver: json-file` en el render "
            f"de producción: {logging_cfg}"
        )
        assert opciones.get("max-size"), (
            f"'{nombre}' no declara `logging.options.max-size` en el render "
            f"de producción"
        )
        assert opciones.get("max-file"), (
            f"'{nombre}' no declara `logging.options.max-file` en el render "
            f"de producción"
        )


def test_caddy_persiste_certificados_en_un_volumen_nombrado():
    """Sin un volumen persistente para `/data`, cada reinicio del contenedor
    pierde los certificados de Let's Encrypt. La emisión tiene límites de
    tasa: un puñado de reinicios seguidos deja el sitio sin certificado
    válido durante aproximadamente una semana. Un bind mount o un `tmpfs` no
    sirven -- tienen que sobrevivir a `docker compose down` sin flags, que es
    justo lo que un volumen con nombre garantiza y los otros dos no."""
    config = _config_produccion()
    montajes = config["services"]["caddy"].get("volumes", [])
    montajes_data = [m for m in montajes if m.get("target") == "/data"]
    assert montajes_data, "'caddy' no monta nada en `/data` en el render de producción"
    tipos = {m.get("type") for m in montajes_data}
    assert tipos == {"volume"}, (
        f"'caddy' debe montar `/data` como volumen nombrado (`type: volume`), "
        f"y se encontró {tipos}"
    )
    nombres_volumen = {m.get("source") for m in montajes_data}
    volumenes_declarados = set(config.get("volumes", {}).keys())
    assert nombres_volumen & volumenes_declarados, (
        f"el volumen montado en `/data` ({nombres_volumen}) no está declarado "
        f"en la sección `volumes:` de nivel superior ({volumenes_declarados})"
    )


def test_el_overlay_de_produccion_exige_dominio():
    """Sin `DOMINIO`, Caddy no tiene para qué host emitir el certificado TLS
    ni a dónde enrutar -- mismo patrón que
    `test_el_overlay_de_produccion_exige_cors_origenes`."""
    resultado = _ejecutar_config(
        "docker-compose.yml",
        "docker-compose.prod.yml",
        omitir=("DOMINIO",),
    )
    assert resultado.returncode != 0, (
        "el render de producción tiene que fallar sin DOMINIO -- en cambio "
        "completó con éxito"
    )
    assert "DOMINIO" in resultado.stderr, (
        f"el render falló, pero el mensaje no menciona DOMINIO -- no es "
        f"accionable para quien despliega: {resultado.stderr!r}"
    )


def test_el_overlay_de_produccion_exige_acme_email():
    """Sin `ACME_EMAIL`, Let's Encrypt no tiene a quién avisar de expiraciones
    o problemas con el certificado -- mismo patrón que `DOMINIO`."""
    resultado = _ejecutar_config(
        "docker-compose.yml",
        "docker-compose.prod.yml",
        omitir=("ACME_EMAIL",),
    )
    assert resultado.returncode != 0, (
        "el render de producción tiene que fallar sin ACME_EMAIL -- en "
        "cambio completó con éxito"
    )
    assert "ACME_EMAIL" in resultado.stderr, (
        f"el render falló, pero el mensaje no menciona ACME_EMAIL -- no es "
        f"accionable para quien despliega: {resultado.stderr!r}"
    )


def test_el_caddyfile_declara_los_headers_de_seguridad_del_unico_borde_publico():
    """`caddy` es el único borde público del stack (ver
    `test_el_render_de_produccion_solo_caddy_publica_puertos_y_son_80_443`), y
    este sistema sirve fichas médicas de menores y comprobantes de pago. Los
    tests de este archivo verifican el render del compose, pero ninguno mira
    el CONTENIDO del `Caddyfile` -- un ruteo o un header equivocado dejaría
    la suite entera en verde. Esta prueba cierra esa parte del hueco (no
    valida sintaxis ni ruteo -- eso queda para `caddy validate` en CI, otro
    cambio) leyendo el `Caddyfile` versionado y exigiendo los cuatro headers
    del bloque `header`:

    - `Strict-Transport-Security`: fuerza HTTPS en el navegador, evita que un
      atacante en la red degrade la conexión a texto plano (downgrade/SSL
      strip).
    - `X-Content-Type-Options: nosniff`: evita que el navegador adivine el
      tipo de contenido y ejecute como script algo que no lo es.
    - `X-Frame-Options: DENY`: evita que el sitio se embeba en un iframe
      ajeno (clickjacking) sobre un formulario que maneja datos sensibles.
    - `Referrer-Policy: strict-origin-when-cross-origin`: evita que la URL
      completa (con IDs de fichas médicas o comprobantes) viaje como
      referrer hacia un sitio de terceros."""
    contenido = (RAIZ / "Caddyfile").read_text()
    assert 'Strict-Transport-Security "max-age=31536000; includeSubDomains"' in contenido, (
        "el Caddyfile no declara Strict-Transport-Security con el max-age "
        "esperado"
    )
    assert 'X-Content-Type-Options "nosniff"' in contenido, (
        "el Caddyfile no declara X-Content-Type-Options: nosniff"
    )
    assert 'X-Frame-Options "DENY"' in contenido, (
        "el Caddyfile no declara X-Frame-Options: DENY"
    )
    assert 'Referrer-Policy "strict-origin-when-cross-origin"' in contenido, (
        "el Caddyfile no declara Referrer-Policy: strict-origin-when-cross-origin"
    )


def test_caddyfile_reemplaza_x_forwarded_for_por_el_peer_real():
    """issue #235, mitad 2 (ingress). Verificado con curl contra un upstream
    real detrás de Caddy 2.8: SIN esta directiva, `reverse_proxy` YA
    reemplaza (no anexa) cualquier `X-Forwarded-For` que mande un visitante
    por el peer TCP real, mientras no haya `trusted_proxies` declarado en la
    config global -- hoy esta línea no cambia el comportamiento en runtime.
    (`caddy validate` incluso la marca como "Unnecessary header_up
    X-Forwarded-For" por esto mismo -- esperado, no es señal de borrarla.)

    Se deja igual, explícita, porque ese default es una propiedad de la
    config GLOBAL de Caddy, no del backend: el día que alguien agregue
    `trusted_proxies` (verificado empíricamente: eso hace que Caddy pase a
    ANEXAR el `X-Forwarded-For` del visitante en vez de reemplazarlo), el
    backend seguiría confiando en esa cabecera para el rate limit anónimo
    por IP (`clave_cliente`, ver backend/app/soporte_transversal/rate_limit.py)
    en cuanto uvicorn ve a este frontend como peer de confianza
    (`--forwarded-allow-ips`, backend/Dockerfile) -- sin `header_up`, esa
    combinación reabriría en silencio el DoS trivial del issue #235,
    dependiendo de un detalle interno de uvicorn (en qué orden camina una
    lista con hops falsos) que este repo no fija en ningún lado. Ver
    `test_el_render_de_produccion_solo_caddy_publica_puertos_y_son_80_443`
    para el resto de la postura del único borde público del stack.

    No valida que Caddy interprete esto como reemplazo y no como agregado --
    eso es exactamente lo que corre `caddy validate` en CI (mencionado en el
    comentario de cabecera del propio Caddyfile), no algo que un test de
    texto pueda demostrar."""
    contenido = (RAIZ / "Caddyfile").read_text()
    assert "header_up X-Forwarded-For {remote_host}" in contenido, (
        "el Caddyfile ya no fija X-Forwarded-For al peer real dentro del "
        "bloque reverse_proxy -- un visitante podría volver a imponer su "
        "propia cabecera (issue #235)"
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


def test_el_frontend_recibe_build_sha_como_build_arg():
    """issue #350: `make qa-up` exporta `BUILD_SHA` con el HEAD local antes de
    invocar Compose, y `frontend/Dockerfile` lo lee como build-arg (no
    `NEXT_PUBLIC_*`: queda server-only, ver ese archivo) para exponerlo en
    `/api/health`. Sin esta clave en `build.args`, el valor que exporta
    `qa-up` nunca llegaría a la imagen y el guardia
    (`scripts/qa_verify_build_sha.py`) siempre vería `unknown`."""
    config = _renderizar("docker-compose.yml", "docker-compose.override.yml")
    args = config["services"]["frontend"]["build"].get("args", {})
    assert "BUILD_SHA" in args, (
        "'frontend' perdió el build-arg BUILD_SHA en el override de desarrollo"
    )
    assert args["BUILD_SHA"] == "unknown", (
        f"sin BUILD_SHA exportado por el entorno, el default esperado es "
        f"'unknown' y se encontró {args['BUILD_SHA']!r}"
    )


# ─── Overlay de QA (`docker-compose.qa.yml`, ver `make qa-up`) ──────────────

_NOMBRE_PROYECTO_QA = "cataclub-qa"

_ARCHIVOS_QA = (
    "docker-compose.yml",
    "docker-compose.override.yml",
    "docker-compose.qa.yml",
)


def _config_qa() -> dict:
    return _renderizar(*_ARCHIVOS_QA)


def test_el_entorno_de_qa_usa_su_propio_nombre_de_proyecto():
    """El aislamiento del entorno de QA descansa en el nombre de proyecto: es
    lo que le da contenedores, red y volúmenes propios, separados de los del
    stack de desarrollo. Si el overlay dejara de declararlo, `docker compose`
    caería al nombre del directorio y `make qa-down` podría destruir el stack
    de desarrollo del mismo checkout."""
    assert _config_qa()["name"] == _NOMBRE_PROYECTO_QA


def test_la_base_de_qa_no_monta_el_volumen_de_desarrollo():
    """Criterio de aceptación del issue #33: un error en las pruebas no puede
    tocar datos reales. La base de QA es efímera (tmpfs), así que ni siquiera
    existe un volumen donde sobrevivan datos entre corridas."""
    montajes = _config_qa()["services"]["db"].get("volumes", [])
    fuentes = {m.get("source") for m in montajes}
    assert "cataclub_db_data" not in fuentes, (
        "el `db` de QA volvió a montar el volumen persistente de desarrollo"
    )
    tipos_en_pgdata = {
        m["type"] for m in montajes if m.get("target") == "/var/lib/postgresql/data"
    }
    assert tipos_en_pgdata == {"tmpfs"}, (
        f"se esperaba PGDATA en tmpfs y se encontró {tipos_en_pgdata or 'nada'}"
    )


def test_qa_fuerza_ambiente_development_en_todos_los_servicios_python():
    """`scripts/entrypoint.sh` solo corre `seed_dev_base.py` cuando
    `AMBIENTE=development`, y `_exigir_config_de_produccion` aborta el arranque
    con `AMBIENTE=production` y configuración de desarrollo. El overlay lo fija
    literal (no `${AMBIENTE:-...}`) para que el entorno sea reproducible aunque
    el `.env` de quien lo levanta diga otra cosa."""
    config = _config_qa()
    for servicio in ("backend", "celery-worker", "celery-beat"):
        assert config["services"][servicio]["environment"]["AMBIENTE"] == "development", (
            f"'{servicio}' no queda en modo development en el overlay de QA"
        )


def test_qa_sigue_publicando_los_puertos_documentados():
    """El README y `tests/e2e/*.live.spec.ts` apuntan a localhost:3000 y
    localhost:8000. El overlay de QA reutiliza los puertos del override de
    desarrollo justamente para no duplicar esa configuración."""
    config = _config_qa()
    for servicio, puerto in (("backend", "8000"), ("frontend", "3000")):
        publicados = {p["published"] for p in config["services"][servicio].get("ports", [])}
        assert puerto in publicados, f"'{servicio}' ya no publica {puerto} en QA"


def test_qa_fuerza_mailpit_sin_credenciales_en_todos_los_servicios_python():
    """QA no puede heredar SMTP_HOST, credenciales ni TLS desde el entorno del
    operador: el smoke de recuperación debe terminar siempre en el Mailpit local,
    nunca en un proveedor SMTP real."""
    config = _config_qa()
    esperado = {
        "SMTP_HOST": "mailpit",
        "SMTP_PORT": "1025",
        "SMTP_USER": "",
        "SMTP_PASSWORD": "",
        "SMTP_STARTTLS": "false",
    }
    for servicio in ("backend", "celery-worker", "celery-beat"):
        environment = config["services"][servicio]["environment"]
        for variable, valor in esperado.items():
            assert str(environment.get(variable)).lower() == valor, (
                f"'{servicio}.{variable}' no fuerza el valor QA seguro {valor!r}: "
                f"{environment.get(variable)!r}"
            )


def test_qa_up_incluye_worker_y_excluye_beat():
    """La recuperación se entrega desde Celery, por lo que el worker es parte
    del stack QA. Beat solo ejecuta cron y debe quedar fuera para no gastar memoria."""
    makefile = (RAIZ / "Makefile").read_text()
    match = re.search(r"^QA_SERVICIOS\s*=\s*(.+)$", makefile, flags=re.MULTILINE)
    assert match, "Makefile no declara QA_SERVICIOS"
    servicios = set(match.group(1).split())
    assert "celery-worker" in servicios
    assert "celery-beat" not in servicios


# ─── Memoria de producción (droplet de 2GB) ─────────────────────────────────


def test_mailpit_no_aparece_en_el_render_de_produccion():
    """mailpit es un cazamoscas de correo de DESARROLLO sin autenticación:
    no tiene lugar en producción, ni siquiera sin puertos publicados (ver
    `test_el_render_de_produccion_no_publica_ni_un_solo_puerto`, que ya
    cubre eso). El servicio entero -- imagen, variables, todo -- vive
    únicamente en `docker-compose.override.yml` (dev-only)."""
    config = _config_produccion()
    assert "mailpit" not in config["services"], (
        "'mailpit' aparece en el render de producción -- el servicio "
        "completo debe vivir solo en docker-compose.override.yml"
    )


# Presupuesto de memoria de un droplet de 2GB (decisión de diseño 4.6/4.7,
# sdd/production-readiness): 1600m deja margen sobre los valores de arranque
# (1440m) para el sistema operativo y los picos, y pone en rojo cualquier
# servicio nuevo sin límite o cualquier límite inflado.
_LIMITE_TOTAL_DE_MEMORIA_BYTES = 1600 * 1024 * 1024


def test_cada_servicio_de_produccion_declara_mem_limit_y_no_se_pasa_del_presupuesto():
    """`docker compose up` (sin Swarm) solo honra `mem_limit`, no
    `deploy.resources.limits` -- de ahí que cada servicio lo declare
    explícito. Sin un tope por servicio, un solo contenedor puede consumir
    toda la RAM del droplet y tumbar al resto por OOM."""
    config = _config_produccion()
    total = 0
    for nombre, datos in config["services"].items():
        limite = datos.get("mem_limit")
        assert limite, (
            f"'{nombre}' no declara `mem_limit` en el render de producción -- "
            f"sin él puede consumir toda la RAM del droplet"
        )
        total += int(limite)
    assert total <= _LIMITE_TOTAL_DE_MEMORIA_BYTES, (
        f"la suma de `mem_limit` de todos los servicios ({total} bytes) supera "
        f"el presupuesto de un droplet de 2GB ({_LIMITE_TOTAL_DE_MEMORIA_BYTES} "
        f"bytes)"
    )


def test_celery_worker_concurrencia_es_uno():
    """Complementa `test_celery_worker_declara_concurrencia_explicita`
    (que solo exige que la bandera exista): en un droplet de 2GB el valor
    tiene que ser 1, no cualquier valor explícito -- cada proceso prefork
    carga la aplicación entera (decisión de diseño 4.6)."""
    config = _config_produccion()
    comando = config["services"]["celery-worker"].get("command") or []
    comando_texto = comando if isinstance(comando, str) else " ".join(comando)
    match = re.search(r"--concurrency[= ](\d+)", comando_texto)
    assert match, f"no se encontró '--concurrency' en el command: {comando_texto!r}"
    assert match.group(1) == "1", (
        f"'celery-worker' declara --concurrency={match.group(1)}, se esperaba 1 "
        f"para un droplet de 2GB"
    )
