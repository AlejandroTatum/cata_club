#!/usr/bin/env bash
# Provider-neutral production deployment. Images are immutable SHA tags; no
# credentials are read or printed by this script.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="${STACK_DIR:-/opt/cata-club}"
RELEASE_RECORD_DIR="${RELEASE_RECORD_DIR:-/var/lib/cata-club/releases}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
BACKUP_CRON_LOG="${BACKUP_CRON_LOG:-/var/log/cataclub-backup.log}"
# shellcheck source=lib/post-checks.sh
source "$SCRIPT_DIR/lib/post-checks.sh"
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
