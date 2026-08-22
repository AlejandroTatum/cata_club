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
    IMAGE_TAG="$IMAGE_TAG" docker compose "${COMPOSE_FILES[@]}" config --images backend
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
    log "Instalando cron de backup (03:30) tras confirmación explícita del operador"
    (crontab -l 2>/dev/null | grep -v 'backup-db.sh' || true
     printf '30 3 * * * cd %s && ./scripts/backup/backup-db.sh >> %s 2>&1\n' "$STACK_DIR" "$BACKUP_CRON_LOG"
    ) | crontab -
    crontab -l | grep 'backup-db.sh' >/dev/null || die "el cron no quedó instalado"
    ;;
esac
