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
  manual-review-required)
        APPROVAL_FILE="${MIGRATION_APPROVAL_FILE:-}"
        [ -n "$APPROVAL_FILE" ] || die "MIGRATION_APPROVAL_FILE es obligatorio para manual-review-required"
        [ -r "$APPROVAL_FILE" ] || die "no se puede leer la aprobación de migración: $APPROVAL_FILE"
        case "$(grep -Ev '^[A-Z_][A-Z_0-9]*=[^=[:cntrl:]]+$' "$APPROVAL_FILE" | grep -v '^$' || true)" in
          '') ;;
          *) die "artefacto de aprobación inválido; solo admite líneas KEY=VALUE" ;;
        esac
        approval_value() {
          local key="$1" value count
          count="$(grep -c "^${key}=" "$APPROVAL_FILE" || true)"
          [ "$count" -eq 1 ] || die "la aprobación debe contener exactamente una línea ${key}"
          value="$(sed -n "s/^${key}=//p" "$APPROVAL_FILE")"
          [ -n "$value" ] || die "la aprobación no puede dejar vacío ${key}"
          printf '%s' "$value"
        }
        [ "$(approval_value IMAGE_TAG)" = "$IMAGE_TAG" ] || die "la aprobación no corresponde a IMAGE_TAG=${IMAGE_TAG}"
        [ "$(approval_value MIGRATION_RANGE)" = "c556legal01->e762rolunico->a790verifcorreo" ] || die "la aprobación no corresponde al rango de migración esperado"
        [ "$(approval_value CURRENT_REVISION)" = "c556legal01" ] || die "la aprobación no corresponde a la revisión desplegada c556legal01"
        [ "$(approval_value PENDING_MIGRATIONS)" = "e762rolunico,a790verifcorreo" ] || die "la aprobación no corresponde a las dos migraciones pendientes"
        [ "$(approval_value RESTORE_CHECK)" = "passed" ] || die "la aprobación requiere RESTORE_CHECK=passed"
        [ "$(approval_value MAINTENANCE_WINDOW)" = "planned" ] || die "la aprobación requiere MAINTENANCE_WINDOW=planned"
        approval_value APPROVED_BY >/dev/null
        approval_value APPROVED_AT >/dev/null
        EXPIRES_AT="$(approval_value EXPIRES_AT)"
        case "$EXPIRES_AT" in
          ????-??-??T??:??:??Z) ;;
          *) die "EXPIRES_AT debe usar UTC ISO-8601 (YYYY-MM-DDTHH:MM:SSZ)" ;;
        esac
        now_utc="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        [ "$EXPIRES_AT" \> "$now_utc" ] || die "la aprobación de migración está expirada"
        log "Aprobación manual válida para ${IMAGE_TAG} y el rango de migración declarado"
        ;;
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
