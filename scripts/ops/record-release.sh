#!/usr/bin/env bash
# Persist only non-secret release metadata used by the guarded rollback command.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

IMAGE_TAG="${IMAGE_TAG:-}"
MIGRATION_COMPATIBILITY="${MIGRATION_COMPATIBILITY:-}"
STACK_DIR="${STACK_DIR:-/opt/cata-club}"
RELEASE_RECORD_DIR="${RELEASE_RECORD_DIR:-/var/lib/cata-club/releases}"

case "$IMAGE_TAG" in
  ''|latest|*[!0-9a-fA-F]*) die "IMAGE_TAG debe ser un SHA hexadecimal inmutable, nunca latest" ;;
esac
case "$MIGRATION_COMPATIBILITY" in
  none|backward-compatible|manual-review-required) ;;
  *) die "MIGRATION_COMPATIBILITY debe ser none, backward-compatible o manual-review-required" ;;
esac

[ -d "$STACK_DIR" ] || die "STACK_DIR no existe: $STACK_DIR"
command -v docker >/dev/null 2>&1 || die "docker no está disponible"
IMAGE_REFERENCE="$(
  cd "$STACK_DIR"
  IMAGE_TAG="$IMAGE_TAG" docker compose -f docker-compose.yml -f docker-compose.prod.yml config --images backend
)"
case "$IMAGE_REFERENCE" in
  ''|*$'\n'*|*":${IMAGE_TAG}") ;;
  *) die "la imagen backend configurada no usa IMAGE_TAG=${IMAGE_TAG}" ;;
esac
[ -n "$IMAGE_REFERENCE" ] || die "Compose no resolvió una imagen para backend"

mkdir -p "$RELEASE_RECORD_DIR"
[ -d "$RELEASE_RECORD_DIR" ] || die "RELEASE_RECORD_DIR no es un directorio: $RELEASE_RECORD_DIR"
tmp="$(mktemp "$RELEASE_RECORD_DIR/.release.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
{
  printf 'IMAGE_TAG=%s\n' "$IMAGE_TAG"
  printf 'IMAGE_REFERENCE=%s\n' "$IMAGE_REFERENCE"
  printf 'MIGRATION_COMPATIBILITY=%s\n' "$MIGRATION_COMPATIBILITY"
  printf 'RECORDED_AT=%s\n' "$(date -u '+%FT%TZ')"
} > "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$RELEASE_RECORD_DIR/${IMAGE_TAG}.env"
cp "$RELEASE_RECORD_DIR/${IMAGE_TAG}.env" "$RELEASE_RECORD_DIR/current.env"
chmod 600 "$RELEASE_RECORD_DIR/current.env"
trap - EXIT
log "Release registrada: ${IMAGE_TAG} (${MIGRATION_COMPATIBILITY})"
