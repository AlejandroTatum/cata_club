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
    # Compose >= 5.5 puede emitir varias líneas para `--images backend`.
    # `sed -n '1p'` toma solo la primera sin cerrar el pipe antes de tiempo
    # (a diferencia de `head -n 1`, que con `pipefail` revienta por SIGPIPE
    # si el emisor escribe una segunda línea).
    IMAGE_TAG="$IMAGE_TAG" docker compose "${COMPOSE_FILES[@]}" config --images backend | sed -n '1p'
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
  log "Validaciones OK"
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
