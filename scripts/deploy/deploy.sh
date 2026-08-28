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

configured_backend_image() {
  (
    cd "$STACK_DIR"
    command -v python3 >/dev/null 2>&1 || die "falta python3 para resolver la imagen backend"
    IMAGE_TAG="$IMAGE_TAG" docker compose "${COMPOSE_FILES[@]}" config --format json | python3 -c 'import json, sys
try:
    services = json.load(sys.stdin).get("services")
    image = services["backend"]["image"] if isinstance(services, dict) and isinstance(services.get("backend"), dict) else None
    if not isinstance(image, str) or not image or "\\n" in image or "\\r" in image:
        raise ValueError
    print(image)
except (ValueError, KeyError, TypeError, json.JSONDecodeError):
    sys.exit(1)'
  )
}

check_remote_image() {
  local image_reference
  image_reference="$(configured_backend_image)"
  case "$image_reference" in
    ''|*$'\n'*|*":${IMAGE_TAG}") ;;
    *) die "la imagen backend configurada no usa IMAGE_TAG=${IMAGE_TAG}" ;;
  esac
  [ -n "$image_reference" ] || die "Compose no resolvió una imagen para backend"
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

do_checks() {
  cd "$STACK_DIR"
  log "Validación: servicios"
  docker compose "${COMPOSE_FILES[@]}" ps -a
  check_celery
  log "Validación: health y readiness internos"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5).read().decode())"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"
  log "Validación: /docs deshabilitado"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend python -c "import urllib.request, urllib.error
try: urllib.request.urlopen('http://127.0.0.1:8000/docs', timeout=5)
except urllib.error.HTTPError as error: raise SystemExit(0 if error.code == 404 else error.code)
else: raise SystemExit('/docs responde en producción')"
  "$SCRIPT_DIR/../ops/check-backup-freshness.sh" --max-age-hours "${BACKUP_MAX_AGE_HOURS:-26}"
  check_chatbot_config
  log "Validaciones OK"
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
  log "Validación: salud de celery-worker y celery-beat"
  esperar_celery_saludable celery-worker
  esperar_celery_saludable celery-beat
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
esperar_celery_saludable() {
  local servicio="$1" intentos=0
  local max_intentos="${CELERY_HEALTH_MAX_INTENTOS:-30}"
  local intervalo="${CELERY_HEALTH_INTERVALO_SEGUNDOS:-5}"
  local salud=""
  command -v python3 >/dev/null 2>&1 || die "falta python3 para verificar la salud de celery"
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
    "       Sin worker/beat sanos, los avisos de vencimiento, de mora y las" \
    "       bandejas de salida de correo quedan sin procesar en silencio." \
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
    pre_deploy_backup
    "$SCRIPT_DIR/../ops/preflight-production.sh"
    check_remote_image
    cd "$STACK_DIR"
    log "Desplegando imágenes con SHA ${IMAGE_TAG}"
    docker compose "${COMPOSE_FILES[@]}" pull
    docker compose "${COMPOSE_FILES[@]}" up -d
    do_checks
    "$SCRIPT_DIR/../ops/record-release.sh"
    ;;
  checks)
    load_image_tag
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
    command -v age >/dev/null 2>&1 || die "falta 'age' en el host (apt-get install -y age); el cron de backup no cifraría"
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
    log "Instalando cron de backup (03:30) y de frescura (07:00) tras confirmación explícita del operador"
    # La verificación de frescura escribe 1-2 líneas por día en el mismo log
    # del backup para no multiplicar archivos sin rotación.
    (crontab -l 2>/dev/null | grep -v -e 'backup-db.sh' -e 'check-backup-freshness.sh' || true
     printf '30 3 * * * cd %s && ./scripts/backup/backup-db.sh >> %s 2>&1\n' "$STACK_DIR" "$BACKUP_CRON_LOG"
     printf '0 7 * * * cd %s && ./scripts/ops/check-backup-freshness.sh >> %s 2>&1\n' "$STACK_DIR" "$BACKUP_CRON_LOG"
    ) | crontab -
    crontab -l | grep 'backup-db.sh' >/dev/null || die "el cron de backup no quedó instalado"
    crontab -l | grep 'check-backup-freshness.sh' >/dev/null || die "el cron de frescura no quedó instalado"
    ;;
esac
