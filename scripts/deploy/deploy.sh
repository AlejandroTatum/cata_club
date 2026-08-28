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
