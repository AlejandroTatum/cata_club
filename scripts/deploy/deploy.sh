#!/usr/bin/env bash
# Provider-neutral production deployment. Images are immutable SHA tags; no
# credentials are read or printed by this script.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="${STACK_DIR:-/opt/cata-club}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
BACKUP_CRON_LOG="${BACKUP_CRON_LOG:-/var/log/cataclub-backup.log}"
cmd="${1:-deploy}"
case "$cmd" in deploy|checks|install-cron) ;; *) die "subcomando desconocido: $cmd" ;; esac
if [ "$cmd" = "install-cron" ] && { [ "$#" -ne 2 ] || [ "${2:-}" != "--confirm-install-cron" ]; }; then
  echo "ERROR: se requiere --confirm-install-cron; no se modifica el crontab" >&2
  exit 2
fi

load_image_tag() {
  if [ -z "${IMAGE_TAG:-}" ] && [ -f "$STACK_DIR/.env" ]; then
    IMAGE_TAG="$(sed -n 's/^IMAGE_TAG=//p' "$STACK_DIR/.env" | head -1)"
    export IMAGE_TAG
  fi
}

verify_checkout_head() {
  local checkout_head stack_image_tag
  [ -f "$STACK_DIR/.env" ] || die "falta ${STACK_DIR}/.env"
  stack_image_tag="$(sed -n 's/^IMAGE_TAG=//p' "$STACK_DIR/.env" | head -1)"
  [ "$stack_image_tag" = "$IMAGE_TAG" ] \
    || die "${STACK_DIR}/.env IMAGE_TAG=${stack_image_tag:-vacío} no coincide con IMAGE_TAG=${IMAGE_TAG}"
  checkout_head="$(git -C "$STACK_DIR" rev-parse --verify HEAD 2>/dev/null)" \
    || die "no se pudo leer Git HEAD del checkout en ${STACK_DIR}"
  [ "$checkout_head" = "$IMAGE_TAG" ] \
    || die "Git HEAD=${checkout_head} no coincide con IMAGE_TAG=${IMAGE_TAG}"
}

# Mismo idioma que `load_image_tag`. El contenedor backend NO recibe `DOMINIO`
# (solo lo declara el servicio `caddy` en docker-compose.prod.yml), y la sonda
# del borde lo necesita para presentar el SNI y el Host del bloque `{$DOMINIO}`
# del Caddyfile: sin eso Caddy no matchea el sitio y la prueba mediría otra
# cosa. Se lee del mismo `.env` y se pasa al `exec` explícitamente, sin tocar
# ningún archivo de Compose. `DOMINIO_INDEXABLE=` no matchea este patrón.
load_dominio() {
  if [ -z "${DOMINIO:-}" ] && [ -f "$STACK_DIR/.env" ]; then
    DOMINIO="$(sed -n 's/^DOMINIO=//p' "$STACK_DIR/.env" | head -1)"
    export DOMINIO
  fi
}

# `"\n"` y `"\r"`, con UN backslash (issue #851). El programa de python va
# entre comillas SIMPLES: bash lo pasa tal cual, así que lo que se escriba acá
# es lo que python compila. `"\\n"` -- que es lo que había -- le llega a python
# como dos caracteres, backslash y `n`, de modo que el filtro comparaba contra
# un backslash-n LITERAL y un salto de línea de verdad pasaba entero. La
# comilla doble exterior de un `"$( ... )"` no cambia nada: dentro de una
# sustitución de comandos el contenido se parsea de cero, que es por lo que
# `preflight-production.sh:126` y `record-release.sh` ya usaban un solo
# backslash aun estando entre comillas dobles.
configured_backend_image() {
  (
    cd "$STACK_DIR"
    command -v python3 >/dev/null 2>&1 || die "falta python3 para resolver la imagen backend"
    IMAGE_TAG="$IMAGE_TAG" docker compose "${COMPOSE_FILES[@]}" config --format json | python3 -c 'import json, sys
try:
    services = json.load(sys.stdin).get("services")
    image = services["backend"]["image"] if isinstance(services, dict) and isinstance(services.get("backend"), dict) else None
    if not isinstance(image, str) or not image or "\n" in image or "\r" in image:
        raise ValueError
    print(image)
except (ValueError, KeyError, TypeError, json.JSONDecodeError):
    sys.exit(1)'
  )
}

# Mismo portón que `preflight-production.sh` y `record-release.sh`: un `|| die`
# sobre la sustitución, una comprobación de no-vacío explícita, y un `case`
# cuyo ÚNICO arm que pasa es `*":${IMAGE_TAG}")`.
#
# El `case` que había acá tenía `''` y `*$'\n'*` en el arm que PASA (la forma
# que los issues #846 y #847 ya sacaron de los otros dos scripts), así que una
# referencia vacía o multilínea seguía viaje: la vacía moría después con
# "Compose no resolvió una imagen" y la multilínea llegaba hasta `docker
# manifest inspect`, que responde `invalid reference format` y deja al operador
# leyendo "no se encontró la imagen configurada" -- un mensaje que apunta al
# registro cuando el problema está en el render de Compose. Comparar el tag
# contra el final de un bloque tampoco servía: un bloque de tres líneas que
# termina en `:${IMAGE_TAG}` daba por bueno el tag de la última.
check_remote_image() {
  local image_reference
  image_reference="$(configured_backend_image)" \
    || die "Compose no resolvió exactamente una imagen para backend"
  [ -n "$image_reference" ] || die "Compose no resolvió exactamente una imagen para backend"
  case "$image_reference" in
    *":${IMAGE_TAG}") ;;
    *) die "la imagen backend configurada no usa IMAGE_TAG=${IMAGE_TAG}" ;;
  esac
  docker manifest inspect "$image_reference" >/dev/null 2>&1 \
    || die "no se encontró la imagen configurada (o el registro no autoriza el acceso)"
}

# Dump lógico ANTES de `up -d`: el entrypoint del backend migra en cada
# arranque y no existen down-migrations, así que el único camino de vuelta es
# este backup. En el primer aprovisionamiento la base nunca arrancó y no hay
# nada que respaldar: se omite con aviso y se tolera la ausencia de dump solo
# durante este deploy (las corridas del cron siguen alertando).
pre_deploy_backup() {
  cd "$STACK_DIR"
  local running
  running="$(docker compose "${COMPOSE_FILES[@]}" ps --status running --services 2>/dev/null || true)"
  if ! printf '%s\n' "$running" | grep -qx 'db'; then
    log "AVISO: el servicio db no está corriendo (primer aprovisionamiento); no hay nada que respaldar"
    export BACKUP_TOLERATE_MISSING=1
    return 0
  fi
  log "Backup pre-deploy: dump lógico antes de migrar"
  "$SCRIPT_DIR/../backup/backup-db.sh"
}

verificar_runtime_sha() {
  local salida
  salida="$(docker compose "${COMPOSE_FILES[@]}" ps --format json)" \
    || die "no se pudo leer el runtime para verificar IMAGE_TAG=${IMAGE_TAG}"
  if ! printf '%s\n' "$salida" | python3 -c '
import json, sys

esperado = sys.argv[1]
bruto = sys.stdin.read().strip()
registros = []
try:
    datos = json.loads(bruto) if bruto else []
except json.JSONDecodeError:
    datos = None
if isinstance(datos, list):
    registros = [item for item in datos if isinstance(item, dict)]
elif isinstance(datos, dict):
    registros = [datos]
elif datos is None:
    for linea in bruto.splitlines():
        try:
            item = json.loads(linea)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            registros.append(item)
requeridos = {"backend", "celery-worker", "celery-beat", "frontend"}
encontrados = {str(item.get("Service")): item for item in registros}
faltantes = sorted(requeridos - encontrados.keys())
incorrectos = sorted(
    servicio for servicio in requeridos & encontrados.keys()
    if not str(encontrados[servicio].get("Image", "")).endswith(":" + esperado)
)
if faltantes or incorrectos:
    partes = []
    if faltantes:
        partes.append("faltan servicios: " + ",".join(faltantes))
    if incorrectos:
        partes.append("servicios con imagen distinta: " + ",".join(incorrectos))
    print("; ".join(partes), file=sys.stderr)
    raise SystemExit(1)
' "$IMAGE_TAG"; then
    die "runtime no coincide con IMAGE_TAG=${IMAGE_TAG} (se esperaba HEAD=${IMAGE_TAG})"
  fi
  log "Runtime alineado con Git HEAD=${IMAGE_TAG}: backend, worker, beat y frontend"
}

verificar_release_persistido() {
  local env_tag ledger_tag
  env_tag="$(sed -n 's/^IMAGE_TAG=//p' "$STACK_DIR/.env" | head -1)"
  ledger_tag="$(sed -n 's/^IMAGE_TAG=//p' "$RELEASE_RECORD_DIR/current.env" | head -1)"
  [ "$env_tag" = "$IMAGE_TAG" ] \
    || die "${STACK_DIR}/.env no quedó alineado: IMAGE_TAG=${env_tag:-vacío}, esperado ${IMAGE_TAG}"
  [ "$ledger_tag" = "$IMAGE_TAG" ] \
    || die "ledger de release no quedó alineado: IMAGE_TAG=${ledger_tag:-vacío}, esperado ${IMAGE_TAG}"
  log "Alineación verificada: runtime = Git HEAD = IMAGE_TAG = ledger = ${IMAGE_TAG}"
}

do_checks() {
  cd "$STACK_DIR"
  log "Validación: servicios"
  docker compose "${COMPOSE_FILES[@]}" ps -a
  check_celery
  log "Validación: health y readiness internos"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5).read().decode())"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"
  verificar_readiness_publica
  log "Validación: /docs deshabilitado"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend python -c "import urllib.request, urllib.error
try: urllib.request.urlopen('http://127.0.0.1:8000/docs', timeout=5)
except urllib.error.HTTPError as error: raise SystemExit(0 if error.code == 404 else error.code)
else: raise SystemExit('/docs responde en producción')"
  "$SCRIPT_DIR/../ops/check-backup-freshness.sh" --max-age-hours "${BACKUP_MAX_AGE_HOURS:-26}"
  check_chatbot_config
  log "Validaciones OK"
}

# Issue #849. `docker compose up -d` recrea un contenedor cuando cambia la
# DEFINICIÓN de su servicio, nunca cuando cambia el CONTENIDO de un archivo
# bind-mounteado. El Caddyfile entra por `./Caddyfile:/etc/caddy/Caddyfile:ro`
# y Caddy lo compila UNA sola vez, al arrancar: un `git pull` que trae una ruta
# nueva no llega al borde hasta que alguien recrea el contenedor a mano.
#
# Medido contra `caddy:2.8-alpine` real, leyendo la config ACTIVA por la API de
# administración y pidiendo la ruta por HTTP:
#
#   host con el Caddyfile nuevo   -> 0 rutas /health/ready activas, HTTP 404
#   docker compose up -d          -> 0 rutas activas, HTTP 404 (no se recreó)
#   up -d --force-recreate caddy  -> 1 ruta activa, HTTP 200
#
# En el incidente el contenedor llevaba 46 h sirviendo la configuración de hace
# 46 h y `/health/ready` caía en el catch-all del frontend, devolviendo el 404
# HTML de Next.js al monitor externo.

# Valida el Caddyfile VERSIONADO antes de activar nada. Corre a través de
# Compose, no con un `docker run` suelto, porque el Caddyfile interpola
# `{$DOMINIO}` y `{$ACME_EMAIL}` del entorno del proceso y esas variables las
# aporta el servicio `caddy` (docker-compose.prod.yml): validado fuera de
# Compose, el archivo se vería como si esos hosts estuvieran vacíos.
#
# `run --rm --no-deps` usa un contenedor descartable: no toca al que está
# sirviendo ni arranca dependencias. Un Caddyfile inválido aborta ACÁ, antes de
# que se recree nada.
validar_caddyfile() {
  log "Validación: Caddyfile versionado (contenedor descartable, no activa nada)"
  if ! docker compose "${COMPOSE_FILES[@]}" run --rm --no-deps \
      --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile; then
    die "$(printf '%s\n' \
      "el Caddyfile versionado no valida; no se recrea el borde público." \
      "       El detalle está arriba. El contenedor que está sirviendo NO se" \
      "       tocó: el sitio sigue en línea con la configuración anterior.")"
  fi
}

# Recrea SOLO caddy para que vuelva a compilar el Caddyfile del host.
#
# `--no-deps` es obligatorio: sin él, Compose arrastra a `frontend` (y por su
# `depends_on`, al resto) a una recreación que este refresco no necesita.
#
# NUNCA `-v`, `--renew-anon-volumes` ni `down`: `caddy_data` guarda los
# certificados de Let's Encrypt y su emisión tiene límite semanal, así que
# perderlos deja el sitio sin certificado válido por días
# (docker-compose.prod.yml, junto a los volúmenes nombrados).
refrescar_caddy() {
  log "Refrescando el borde público: recreación acotada de caddy"
  docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate --no-deps caddy
  esperar_servicio_saludable caddy "$(printf '%s\n' \
    "       Sin caddy sano no hay borde público: el sitio entero queda" \
    "       inalcanzable aunque backend y frontend estén corriendo.")"
}

# Prueba `/health/ready` POR EL BORDE, que es lo que consume el monitor
# externo. `do_checks` ya lo probaba dentro del contenedor backend
# (127.0.0.1:8000), lo cual esquiva Caddy por completo -- por eso el deploy del
# incidente quedó en verde con el borde sirviendo una configuración vieja.
#
# Se sondea desde el contenedor backend (tiene python) hacia el servicio
# `caddy` por la red interna de Compose: sin DNS público y sin certificado
# válido para ese nombre, de ahí el `server_hostname` explícito y la
# verificación desactivada. Acá NO se está probando TLS, se está probando el
# enrutamiento.
#
# El bloque del sitio es `{$DOMINIO}`, así que la petición tiene que presentar
# ese SNI y ese Host o Caddy no matchea el sitio y la prueba mediría otra cosa.
#
# Exigir JSON, no solo un 200: cuando la ruta del backend no está en la config
# activa, la petición cae en el catch-all del frontend y Next.js contesta su
# propia página de error -- que puede ser un 200 perfectamente legible para un
# chequeo que solo mire el código de estado.
verificar_readiness_publica() {
  load_dominio
  [ -n "${DOMINIO:-}" ] || die "$(printf '%s\n' \
    "falta DOMINIO para probar /health/ready por el borde público." \
    "       Es la misma variable que ${STACK_DIR}/.env ya le da a caddy" \
    "       (docker-compose.prod.yml): sin ella no hay Host que presentar.")"
  log "Validación: /health/ready por el borde público (a través de Caddy)"
  if ! docker compose "${COMPOSE_FILES[@]}" exec -T -e DOMINIO="$DOMINIO" backend python -c '
import json, os, socket, ssl, sys
dominio = os.environ["DOMINIO"]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
with socket.create_connection(("caddy", 443), timeout=10) as raw:
    with ctx.wrap_socket(raw, server_hostname=dominio) as sock:
        sock.sendall(
            f"GET /health/ready HTTP/1.1\r\nHost: {dominio}\r\n"
            "Connection: close\r\n\r\n".encode()
        )
        datos = b""
        while True:
            trozo = sock.recv(4096)
            if not trozo:
                break
            datos += trozo
cabecera, _, cuerpo = datos.partition(b"\r\n\r\n")
estado = cabecera.split(b"\r\n", 1)[0].decode(errors="replace")
if " 200 " not in estado:
    raise SystemExit(f"/health/ready por el borde respondió {estado!r}")
texto = cuerpo.decode(errors="replace").strip()
if texto[:1] not in "{[":
    raise SystemExit(f"/health/ready por el borde devolvió HTML del frontend, no JSON: {texto[:120]!r}")
json.loads(texto)
'; then
    die "$(printf '%s\n' \
      "/health/ready no responde JSON por el borde público." \
      "       El detalle está arriba. Si devolvió HTML, la ruta del backend no" \
      "       está en la configuración ACTIVA de Caddy y la petición cayó en el" \
      "       catch-all del frontend: el monitor externo estaría leyendo un 404" \
      "       de Next.js como si fuera un sitio sano. Revisá:" \
      "         docker compose ${COMPOSE_FILES[*]} logs caddy")"
  fi
}

# Issue #791, punto 3. `docker compose ps -a` de la línea anterior solo
# IMPRIME: nada leía esa salida, así que una imagen que rompe el arranque de
# celery-worker o celery-beat dejaba el deploy en verde y
# `record-release.sh` anotaba el release como bueno con las tareas
# asíncronas (vencimientos, mora, las bandejas de salida de correo) muertas
# en silencio. `docker-compose.yml` YA declara un healthcheck bien diseñado
# para cada uno (`inspect ping -d` para el worker, freshness del
# `celerybeat-schedule` para beat); lo que faltaba era que algo los leyera.
#
# Fuera de Swarm, Compose no reinicia un contenedor por quedar `unhealthy`
# -- solo por salir --, así que sin este candado un contenedor enfermo podía
# quedar así indefinidamente sin que nada lo notara.
check_celery() {
  local consecuencia
  consecuencia="$(printf '%s\n' \
    "       Sin worker/beat sanos, los avisos de vencimiento, de mora y las" \
    "       bandejas de salida de correo quedan sin procesar en silencio.")"
  log "Validación: salud de celery-worker y celery-beat"
  esperar_servicio_saludable celery-worker "$consecuencia"
  esperar_servicio_saludable celery-beat "$consecuencia"
  # Round-trip real, no solo el `Health` cacheado de Docker (que puede tener
  # hasta un `interval` de atraso): un ping de control disparado ACÁ, desde
  # el mismo contenedor backend que encola las tareas reales, prueba que el
  # broker está alcanzable y que el worker sigue respondiendo en este
  # instante. Mínimo razonable para un gate de deploy (no un sistema de
  # monitoreo): un round-trip de encolar-y-esperar una tarea de negocio real
  # tendría efectos secundarios en producción, y agregar una tarea nueva
  # solo para esto es más superficie de la que este chequeo justifica.
  log "Validación: round-trip de celery-worker (ping real al broker)"
  if ! docker compose "${COMPOSE_FILES[@]}" exec -T backend \
      uv run celery -A app.infraestructura.tareas.celery_app inspect ping \
      --timeout "${CELERY_PING_TIMEOUT_SEGUNDOS:-10}" >/dev/null; then
    die "$(printf '%s\n' \
      "celery-worker no respondió al ping de control (broker/cola de" \
      "       tareas). Los avisos de vencimiento, de mora y las bandejas de" \
      "       salida de correo dependen de este worker. Revisá:" \
      "         docker compose ${COMPOSE_FILES[*]} logs celery-worker")"
  fi
}

# Sondea `docker compose ps --format json` hasta ver `Health: healthy` para
# el servicio pedido, o aborta. Un poll acotado -- no una sola lectura -- es
# necesario: justo después de `up -d` el contenedor recién creado está
# `starting` (celery-worker declara `start_period: 90s` porque arranca el
# runtime de uv, importa la app entera y conecta con Redis antes de poder
# contestar el ping), así que una sola lectura fallaría en CADA deploy sano.
# Servicio ausente (nunca llegó a crearse) da `Health` vacío -> mismo
# camino de falla que "unhealthy", no un pase silencioso.
#
# El segundo argumento es la CONSECUENCIA que se imprime al abortar: qué queda
# roto sin ese servicio. Lo aporta cada llamador porque no es la misma para
# celery (tareas asíncronas mudas) que para caddy (el sitio entero fuera de
# línea), y un mensaje genérico no le sirve a nadie a las tres de la mañana.
#
# SIN filtro posicional de servicio (`ps --format json <servicio>`): no es
# un contrato estable entre versiones de Compose, y agregarlo suma un
# segundo modo de falla version-dependiente además del de la forma de
# salida (ver `como_lista` más abajo). Se pide SIEMPRE el listado completo
# y se filtra del lado de Python por el campo `Service`.
#
# `ps --format json` tampoco tiene una forma de salida estable: Compose
# reciente emite JSON Lines (un objeto por línea); versiones más viejas
# emiten un único array JSON. `como_lista` acepta las dos, y cualquier otra
# cosa -- salida vacía, un escalar suelto, basura no-JSON -- resuelve a
# lista vacía en vez de propagar una excepción que mate a python3 (eso
# dejaría `salud` en `""` por la razón EQUIVOCADA -- "no pude interpretar
# la salida" en vez de "el servicio no está sano" -- pero el resultado
# tiene que seguir siendo fail-closed en los dos casos: nunca un pase
# silencioso).
#
# Regla ante más de un registro para el mismo servicio: sano solo si TODOS
# los registros que matchean están 'healthy'. Un solo registro enfermo tira
# abajo el servicio entero, aunque otro luzca bien -- fail-closed también
# ante la ambigüedad de cuál de los dos es "el" contenedor real.
#
# Alcanzabilidad verificada, no supuesta: `ps` (sin `-a`/`--all`, que este
# script nunca pasa) NO lista contenedores `exited` -- `docker compose ps
# --help` es explícito: "-a, --all Show all stopped containers". Un
# contenedor `exited` de un intento previo NO puede producir un segundo
# registro acá; esa justificación era incorrecta y se retira. Tampoco hay
# HOY ningún `deploy.replicas` ni `--scale` para celery-worker/celery-beat
# en ningún compose de este repo (verificado con `rg`). El caso SÍ se
# activaría el día que alguien agregue `deploy.replicas` a
# docker-compose.prod.yml para escalar el worker -- un cambio que no toca
# este script y que nadie tendría motivo de recordar que también le compete
# a este healthcheck. La regla se mantiene (y se fija con tests) porque es
# una comparación de un conjunto, no una feature nueva: barata de conservar,
# cara de perder en silencio si alguien la "simplifica" a `in` en vez de
# `==` -- que es exactamente lo que pasó una vez, sin que ningún test lo
# notara.
esperar_servicio_saludable() {
  local servicio="$1" consecuencia="$2" intentos=0
  local max_intentos="${SERVICIO_HEALTH_MAX_INTENTOS:-30}"
  local intervalo="${SERVICIO_HEALTH_INTERVALO_SEGUNDOS:-5}"
  local salud=""
  command -v python3 >/dev/null 2>&1 || die "falta python3 para verificar la salud de $servicio"
  # `while [ cond ]` (no `[ cond ] && break`): con `set -e`, un `&&` a nivel
  # de sentencia tumba el script entero apenas la condición izquierda es
  # falsa -- el mismo motivo por el que `check_chatbot_config` arma `exigir`
  # con `if`, no con `&&`, un poco más abajo en este archivo.
  while [ "$intentos" -lt "$max_intentos" ]; do
    salud="$(docker compose "${COMPOSE_FILES[@]}" ps --format json 2>/dev/null \
      | python3 -c 'import json, sys


def como_lista(bruto):
    bruto = bruto.strip()
    if not bruto:
        return []
    datos = None
    try:
        datos = json.loads(bruto)
    except Exception:
        datos = None
    if isinstance(datos, list):
        return [item for item in datos if isinstance(item, dict)]
    if isinstance(datos, dict):
        return [datos]
    if datos is not None:
        # Un JSON válido pero de forma inesperada (string, numero, bool,
        # null suelto): no es una lista de contenedores interpretable.
        return []
    # No parseó como un único documento JSON: probar JSON Lines. Cada
    # línea se intenta por separado y las que no parsean se descartan --
    # basura intercalada no debe tumbar a las líneas buenas ni al proceso.
    registros = []
    for linea in bruto.splitlines():
        linea = linea.strip()
        if not linea:
            continue
        try:
            objeto = json.loads(linea)
        except Exception:
            continue
        if isinstance(objeto, dict):
            registros.append(objeto)
    return registros


servicio_pedido = sys.argv[1]
coincidencias = [
    r for r in como_lista(sys.stdin.read()) if r.get("Service") == servicio_pedido
]
if not coincidencias:
    print("")
else:
    estados = {str(r.get("Health", "")) for r in coincidencias}
    print("healthy" if estados == {"healthy"} else ",".join(sorted(estados)))
' "$servicio")"
    if [ "$salud" = "healthy" ]; then
      return 0
    fi
    intentos=$((intentos + 1))
    if [ "$intentos" -lt "$max_intentos" ]; then
      sleep "$intervalo"
    fi
  done
  die "$(printf '%s\n' \
    "$servicio no reportó healthcheck 'healthy' tras $((max_intentos * intervalo))s" \
    "       (último estado: '${salud:-sin healthcheck o el servicio no está corriendo}')." \
    "$consecuencia" \
    "       Revisá:" \
    "         docker compose ${COMPOSE_FILES[*]} ps -a" \
    "         docker compose ${COMPOSE_FILES[*]} logs $servicio")"
}

# Smoke check de la clave del proveedor del chatbot (issue #766). No imprime el
# secreto ni contacta la red: solo comprueba que llegó al proceso y que puede
# ser una credencial.
#
# Corre ACÁ, dentro de `do_checks` y por lo tanto DESPUÉS de `up -d`, y no en el
# preflight: el entorno de un contenedor se fija al crearlo, así que antes de
# recrearlos el backend todavía tiene la clave vieja y el chequeo mediría el
# despliegue anterior. Es el mismo motivo por el que el runbook manda a recrear
# y no a reiniciar.
#
# Qué aborta y qué no:
#   1 INCOMPLETA -> aborta. Comillas, espacios o el `<placeholder>` sin
#     reemplazar: SIEMPRE un error del operador, nunca una decisión. Es
#     exactamente el fallo que costó una hora de SSH. Abortar acá no revierte
#     nada (las imágenes ya están arriba), pero deja el deploy en rojo y
#     `record-release.sh` sin correr, o sea que el release NO queda anotado
#     como bueno con una configuración que se sabe rota.
#   0 CONFIGURADA/AUSENTE -> sigue. Un club que no habilitó el asistente es un
#     despliegue legítimo: `opencode_api_key` está fuera del fail-fast de
#     `Settings` a propósito, y negar el deploy de TODA la app por una función
#     opcional contradiría esa decisión.
#   2 AUSENTE con --exigir -> aborta, pero solo si el operador declaró
#     `CHATBOT_REQUERIDO=1`. Ese flag es la forma de decir "este despliegue SÍ
#     habilitó el chatbot", que es justo la distinción para la que existe
#     `--exigir`.
check_chatbot_config() {
  # `exigir` arranca vacío y solo se llena con el flag: un `&& asignación` sin
  # `if` devolvería 1 cuando la condición es falsa y `set -e` tumbaría el
  # deploy entero por no haber pedido `--exigir`.
  local exigir=""
  if [ "${CHATBOT_REQUERIDO:-0}" = "1" ]; then
    exigir="--exigir"
  fi
  log "Validación: configuración del proveedor del chatbot (no imprime el secreto)"
  if ! docker compose "${COMPOSE_FILES[@]}" exec -T backend \
      uv run python scripts/verificar_chatbot.py ${exigir:+"$exigir"}; then
    die "$(printf '%s\n' \
      "la configuración del chatbot no pasó el smoke check." \
      "       Corregí OPENCODE_API_KEY en ${STACK_DIR}/.env y RECREÁ los" \
      "       contenedores (un restart conserva el entorno viejo):" \
      "         docker compose ${COMPOSE_FILES[*]} up -d backend celery-worker celery-beat" \
      "       Las imágenes nuevas YA están corriendo; el release no quedó registrado.")"
  fi
}

case "$cmd" in
  deploy)
    load_image_tag
    verify_checkout_head
    pre_deploy_backup
    "$SCRIPT_DIR/../ops/preflight-production.sh"
    check_remote_image
    cd "$STACK_DIR"
    log "Desplegando imágenes con SHA ${IMAGE_TAG}"
    docker compose "${COMPOSE_FILES[@]}" pull
    validar_caddyfile
    docker compose "${COMPOSE_FILES[@]}" up -d
    refrescar_caddy
    verificar_runtime_sha
    do_checks
    "$SCRIPT_DIR/../ops/record-release.sh"
    verificar_release_persistido
    ;;
  checks)
    load_image_tag
    verify_checkout_head
    "$SCRIPT_DIR/../ops/preflight-production.sh"
    do_checks
    ;;
  install-cron)
    # El cron corre con un entorno mínimo y NO hereda el shell del operador:
    # si el destinatario de cifrado solo existe como variable exportada en esta
    # sesión, backup-db.sh falla a las 03:30 contra un log que nadie mira hasta
    # que alerta la frescura a las 07:00. Se verifica ahora, con el operador
    # todavía en la terminal, que la configuración esté donde el cron la va a
    # encontrar de verdad.
    BACKUP_AGE_RECIPIENTS_FILE="${BACKUP_AGE_RECIPIENTS_FILE:-/etc/cataclub/backup-recipients.txt}"
    if ! grep -qs '[^[:space:]]' "$BACKUP_AGE_RECIPIENTS_FILE"; then
      die "$(printf '%s\n' \
        "no hay destinatario de cifrado en ${BACKUP_AGE_RECIPIENTS_FILE}." \
        "       El cron no hereda variables de tu shell: el backup tiene que" \
        "       leer la clave pública de un archivo. Crealo y repetí:" \
        "         install -d -m 700 \$(dirname ${BACKUP_AGE_RECIPIENTS_FILE})" \
        "         printf '%s\\n' age1... > ${BACKUP_AGE_RECIPIENTS_FILE}" \
        "       La identidad PRIVADA no va en este host.")"
    fi
    # Un solo destinatario `age` es un solo punto de fallo sobre el histórico
    # entero de backups (issue #791): si esa identidad privada se pierde
    # (droplet robado, gestor de contraseñas comprometido), TODO lo cifrado
    # con ella queda irrecuperable para siempre. Se cuenta acá, con el
    # operador todavía en la terminal -- el mismo criterio que el resto de
    # las compuertas de `install-cron`. `backup-db.sh` NO falla por esto: solo
    # avisa, porque corre a las 03:30 sin nadie mirando y seguir produciendo
    # backups (aunque sea con un solo destinatario) es mejor que dejar de
    # producirlos.
    destinatarios_count="$(grep -vEc '^[[:space:]]*(#|$)' "$BACKUP_AGE_RECIPIENTS_FILE" || true)"
    if [ "${destinatarios_count:-0}" -lt 2 ]; then
      die "$(printf '%s\n' \
        "solo hay ${destinatarios_count:-0} destinatario(s) de cifrado en ${BACKUP_AGE_RECIPIENTS_FILE}." \
        "       Con una sola identidad age, perderla vuelve irrecuperable TODO" \
        "       el histórico de backups cifrado con ella. Agregá un segundo destinatario" \
        "       (identidad PRIVADA distinta, en un gestor de contraseñas distinto):" \
        "         printf '%s\\n' age1... >> ${BACKUP_AGE_RECIPIENTS_FILE}")"
    fi
    command -v age >/dev/null 2>&1 || die "falta 'age' en el host (apt-get install -y age); el cron de backup no cifraría"
    # Misma compuerta para la réplica fuera del host: si está activada y le
    # falta algo, el backup de las 03:30 escribe el artefacto local y después
    # sale distinto de cero contra un log que nadie mira. La verificación la
    # hace el propio uploader (--check-config no toca la red ni necesita un
    # artefacto), así que el formato del archivo y los mensajes viven en UN
    # solo lugar. Con la réplica desactivada sale 0 y no molesta.
    "$SCRIPT_DIR/../backup/upload-b2.sh" --check-config \
      || die "$(printf '%s\n' \
        "la réplica del backup fuera del host está activada pero mal configurada." \
        "       El detalle está arriba. No se instala un cron que replicaría" \
        "       nada todas las noches: ver docs/operations/backup-offsite.md")"
    # Las DOS entradas del cron redirigen su salida a `$BACKUP_CRON_LOG`. Una
    # redirección que falla aborta el comando ANTES de ejecutarlo, así que un
    # log inescribible no degrada el monitoreo: lo apaga entero. Se caen juntos
    # el backup de las 03:30 y la verificación de frescura de las 07:00, que es
    # justamente lo único que avisaría del backup muerto -- y sin MAILTO ni MTA
    # en el host, las dos mueren sin dejar rastro mientras `install-cron`
    # reporta éxito.
    #
    # Pasó en el host real: `/var/log` es `drwxrwxr-x root:syslog` y el usuario
    # que corre el deploy no está en `syslog`, así que no podía crear el
    # archivo. Se verifica ACÁ, con el operador todavía en la terminal, por el
    # mismo motivo que el destinatario de cifrado de arriba.
    #
    # El `2>/dev/null` va ANTES del `>>`: las redirecciones se aplican de
    # izquierda a derecha, y el aviso que emite el propio shell cuando una
    # redirección falla sale por el stderr vigente en ese momento. Al revés, ese
    # aviso crudo se filtraría a la terminal por delante del mensaje explicado.
    if ! { [ -f "$BACKUP_CRON_LOG" ] && [ -w "$BACKUP_CRON_LOG" ]; } \
       && ! : 2>/dev/null >> "$BACKUP_CRON_LOG"; then
      die "$(printf '%s\n' \
        "el cron no puede escribir su propio log: ${BACKUP_CRON_LOG}." \
        "       La redirección '>> ${BACKUP_CRON_LOG}' falla antes de ejecutar el" \
        "       comando, así que se caerían las DOS entradas a la vez: el backup" \
        "       de las 03:30 y la alarma de frescura de las 07:00, que es lo único" \
        "       que avisaría del backup muerto. Sin MAILTO ni MTA, en silencio." \
        "       Creá el archivo a nombre del usuario que corre el cron y repetí:" \
        "         sudo install -o \$(id -un) -g \$(id -gn) -m 640 /dev/null ${BACKUP_CRON_LOG}")"
    fi
    # El heartbeat es la mitad que mira DESDE AFUERA: el monitor externo alerta
    # cuando el ping deja de llegar, así que cubre lo que ningún control local
    # puede cubrir -- que el host entero se haya caído, cron incluido.
    #
    # Sin el archivo se ABORTA, no se instala el cron sin el ping. Instalar
    # igual con un aviso sería degradar la protección en silencio: el crontab
    # quedaría con sus dos líneas de siempre, `crontab -l` se vería impecable, y
    # el aviso se lo lleva el scroll de la terminal. Meses después nadie sabe
    # que el dead-man's-switch nunca se cableó y no hay nada que lo delate --
    # que es exactamente la clase de falla muda que este cambio vino a cerrar.
    # Abortar, en cambio, no cuesta nada: `install-cron` reescribe el crontab
    # entero en cada corrida, así que el estado tras el aborto es el de antes y
    # el operador está mirando el comando que lo arregla. Mismo criterio que la
    # compuerta del destinatario de cifrado, unas líneas más arriba.
    HEARTBEAT_URL_FILE="${HEARTBEAT_URL_FILE:-/etc/cataclub/heartbeat-url.txt}"
    if ! grep -qs '[^[:space:]]' "$HEARTBEAT_URL_FILE"; then
      die "$(printf '%s\n' \
        "no hay URL de heartbeat en ${HEARTBEAT_URL_FILE}." \
        "       El monitor externo alerta cuando el ping DEJA de llegar: es lo" \
        "       único que avisa si se cae el host entero y el cron con él." \
        "       Creá el archivo (la URL NO va en el crontab, que cualquiera" \
        "       lista con 'crontab -l') y repetí:" \
        "         sudo install -d -m 700 \$(dirname ${HEARTBEAT_URL_FILE})" \
        "         printf '%s\\n' 'https://...' | sudo tee ${HEARTBEAT_URL_FILE}" \
        "         sudo chmod 640 ${HEARTBEAT_URL_FILE}" \
        "       Ver docs/operations/provisioning.md.")"
    fi
    # Mismo criterio que la compuerta de `age`: la dependencia del cron se
    # verifica acá y no cuando el cron corra. Sin `curl`, `install-cron`
    # reportaría éxito y el ping recién fallaría a las 07:00 del día siguiente,
    # dejando el monitor externo en alerta por una herramienta ausente y no por
    # un backup vencido -- la alarma correcta por el motivo equivocado.
    command -v curl >/dev/null 2>&1 || die "falta 'curl' en el host (apt-get install -y curl); el heartbeat no podría pingear"
    log "Instalando cron de backup (03:30) y de frescura + heartbeat (07:00) tras confirmación explícita del operador"
    # La verificación de frescura escribe 1-2 líneas por día en el mismo log
    # del backup para no multiplicar archivos sin rotación.
    #
    # El heartbeat cuelga de un `&&`, nunca de un `;`: se pingea SOLO si el
    # chequeo salió 0. `check-backup-freshness.sh` sale 1 sin ningún dump y 2
    # con un dump vencido, y en los dos casos el ping tiene que FALTAR -- la
    # ausencia del ping es lo que dispara la alarma. Un `;` pondría el monitor
    # en verde justo cuando hay que alertar, que es peor que no monitorear:
    # daría una garantía falsa. El `cd` también está encadenado con `&&`, así
    # que un STACK_DIR que ya no existe tampoco pingea.
    #
    # `--max-age-hours` explícito, en paridad con `do_checks` y con
    # preflight-production.sh: el umbral del RPO se declara en un solo lugar del
    # repo y no queda a merced del default interno del script.
    #
    # La URL del heartbeat NO aparece acá: `notify-heartbeat.sh` la lee de un
    # archivo de root. `crontab -l` no pide privilegios, y quien lea esa URL
    # puede pingear a mano y dejar la alarma en verde con el backup muerto.
    (crontab -l 2>/dev/null | grep -v -e 'backup-db.sh' -e 'check-backup-freshness.sh' || true
     printf '30 3 * * * cd %s && ./scripts/backup/backup-db.sh >> %s 2>&1\n' "$STACK_DIR" "$BACKUP_CRON_LOG"
     printf '0 7 * * * cd %s && ./scripts/ops/check-backup-freshness.sh --max-age-hours %s >> %s 2>&1 && ./scripts/ops/notify-heartbeat.sh >> %s 2>&1\n' \
       "$STACK_DIR" "${BACKUP_MAX_AGE_HOURS:-26}" "$BACKUP_CRON_LOG" "$BACKUP_CRON_LOG"
    ) | crontab -
    crontab -l | grep 'backup-db.sh' >/dev/null || die "el cron de backup no quedó instalado"
    crontab -l | grep 'check-backup-freshness.sh' >/dev/null || die "el cron de frescura no quedó instalado"
    crontab -l | grep 'notify-heartbeat.sh' >/dev/null || die "el cron no quedó con el ping de heartbeat"
    ;;
esac
