#!/usr/bin/env bash
# Guarded application-image rollback. It never runs a schema downgrade.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }
usage() { echo "uso: rollback-release.sh <sha-objetivo> --confirm-rollback" >&2; }

TARGET_TAG="${1:-}"
CONFIRM="${2:-}"
[ "$#" -eq 2 ] || { usage; exit 2; }
case "$TARGET_TAG" in
  ''|latest|*[!0-9a-fA-F]*) die "el SHA objetivo debe ser hexadecimal e inmutable" ;;
esac
[ "$CONFIRM" = "--confirm-rollback" ] || { echo "ERROR: se requiere --confirm-rollback; no se ejecuta ningún cambio" >&2; exit 2; }

STACK_DIR="${STACK_DIR:-/opt/cata-club}"
RELEASE_RECORD_DIR="${RELEASE_RECORD_DIR:-/var/lib/cata-club/releases}"
CURRENT_RECORD="$RELEASE_RECORD_DIR/current.env"
TARGET_RECORD="$RELEASE_RECORD_DIR/${TARGET_TAG}.env"
[ -f "$CURRENT_RECORD" ] || die "no hay registro de release actual; no se ejecuta ningún cambio"
# The record is written by record-release.sh and contains a closed, non-secret set.
# Parse instead of sourcing so arbitrary shell text can never run here.
CURRENT_COMPATIBILITY="$(sed -n 's/^MIGRATION_COMPATIBILITY=//p' "$CURRENT_RECORD" | head -1)"
case "$CURRENT_COMPATIBILITY" in
  none|backward-compatible) ;;
  manual-review-required) die "la release actual es manual-review-required; no ejecuta rollback automático" ;;
  *) die "registro de release inválido; no se ejecuta ningún cambio" ;;
esac
[ -f "$TARGET_RECORD" ] || die "el SHA objetivo no tiene un registro local; no se ejecuta ningún cambio"
[ "$(sed -n 's/^IMAGE_TAG=//p' "$TARGET_RECORD" | head -1)" = "$TARGET_TAG" ] \
  || die "el registro del SHA objetivo no está alineado; no se ejecuta ningún cambio"
[ -d "$STACK_DIR" ] || die "STACK_DIR no existe: $STACK_DIR"
[ -f "$STACK_DIR/.env" ] || die "falta $STACK_DIR/.env"
command -v docker >/dev/null 2>&1 || die "docker no está disponible"

persist_project_env() {
  local tmp
  tmp="$(mktemp "$STACK_DIR/.env.rollback.XXXXXX")" \
    || die "no se pudo preparar ${STACK_DIR}/.env para persistir IMAGE_TAG=${TARGET_TAG}"
  trap 'rm -f "$tmp"' EXIT
  awk -v tag="$TARGET_TAG" '
    BEGIN { found = 0 }
    /^IMAGE_TAG=/ {
      if (!found) { print "IMAGE_TAG=" tag; found = 1 }
      next
    }
    { print }
    END { if (!found) print "IMAGE_TAG=" tag }
  ' "$STACK_DIR/.env" > "$tmp" \
    || die "no se pudo escribir ${STACK_DIR}/.env para persistir IMAGE_TAG=${TARGET_TAG}"
  chmod 600 "$tmp"
  mv -f "$tmp" "$STACK_DIR/.env"
  trap - EXIT
}

log "Rollback de aplicación a ${TARGET_TAG}; no se ejecutará alembic downgrade"
(
  cd "$STACK_DIR"
  IMAGE_TAG="$TARGET_TAG" docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
  IMAGE_TAG="$TARGET_TAG" docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
)
persist_project_env
cp "$TARGET_RECORD" "$CURRENT_RECORD"
chmod 600 "$CURRENT_RECORD"
log "Rollback de aplicación completado. Registrar/validar el estado antes de otro cambio."
