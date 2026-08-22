#!/usr/bin/env bash
# Read-only checks before a production release. It intentionally cannot infer
# Alembic rollback safety; the migration author must attest the declared class.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="${STACK_DIR:-/opt/cata-club}"
IMAGE_TAG="${IMAGE_TAG:-}"
MIGRATION_COMPATIBILITY="${MIGRATION_COMPATIBILITY:-}"

[ -d "$STACK_DIR" ] || die "STACK_DIR no existe: $STACK_DIR"
[ -f "$STACK_DIR/.env" ] || die "falta $STACK_DIR/.env"
case "$IMAGE_TAG" in
  ''|latest|*[!0-9a-fA-F]*) die "IMAGE_TAG debe ser un SHA hexadecimal inmutable, nunca latest" ;;
esac
case "$MIGRATION_COMPATIBILITY" in
  none|backward-compatible) ;;
  manual-review-required) die "MIGRATION_COMPATIBILITY=manual-review-required: revisar y aprobar un plan manual; este control no despliega" ;;
  *) die "MIGRATION_COMPATIBILITY debe declarar none, backward-compatible o manual-review-required" ;;
esac
command -v docker >/dev/null 2>&1 || die "docker no está disponible"

docker compose version >/dev/null || die "docker compose no está disponible"
(
  cd "$STACK_DIR"
  docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
) || die "la configuración Compose de producción no es válida"
IMAGE_REFERENCE="$(
  cd "$STACK_DIR"
  IMAGE_TAG="$IMAGE_TAG" docker compose -f docker-compose.yml -f docker-compose.prod.yml config --images backend
)"
case "$IMAGE_REFERENCE" in
  ''|*$'\n'*|*":${IMAGE_TAG}") ;;
  *) die "la imagen backend configurada no usa IMAGE_TAG=${IMAGE_TAG}" ;;
esac
[ -n "$IMAGE_REFERENCE" ] || die "Compose no resolvió una imagen para backend"
"$SCRIPT_DIR/check-backup-freshness.sh" --max-age-hours "${BACKUP_MAX_AGE_HOURS:-26}"
log "Preflight OK: ${IMAGE_REFERENCE}; migración declarada ${MIGRATION_COMPATIBILITY}"
