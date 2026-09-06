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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK_DIR="${STACK_DIR:-/opt/cata-club}"
RELEASE_RECORD_DIR="${RELEASE_RECORD_DIR:-/var/lib/cata-club/releases}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
# shellcheck source=../deploy/lib/post-checks.sh
source "$SCRIPT_DIR/../deploy/lib/post-checks.sh"
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
  IMAGE_TAG="$TARGET_TAG" docker compose "${COMPOSE_FILES[@]}" pull
  IMAGE_TAG="$TARGET_TAG" docker compose "${COMPOSE_FILES[@]}" up -d
)
persist_project_env
cp "$TARGET_RECORD" "$CURRENT_RECORD"
chmod 600 "$CURRENT_RECORD"

# Mismos post-chequeos que `deploy.sh` corre tras un `up -d` (issue #1064): el
# rollback es el camino que se usa bajo presión, después de que un deploy
# salió mal, y hasta acá tenía MENOS candados que el camino normal. Se abortan
# ruidosamente ante cualquier falla, con el mismo criterio fail-closed: la
# imagen y el ledger YA quedaron persistidos arriba, así que un `die` acá deja
# evidencia (el registro apunta al SHA objetivo) en vez de tapar el estado
# real. Se deja fuera a propósito `do_checks` entero (deploy.sh): el chequeo
# de `/docs` deshabilitado, la frescura del backup y el smoke del chatbot no
# son sobre la salud del borde tras un rollback.
(
  cd "$STACK_DIR"
  refrescar_caddy
  check_celery
  verificar_readiness_publica
)
log "Rollback de aplicación completado. Registrar/validar el estado antes de otro cambio."
