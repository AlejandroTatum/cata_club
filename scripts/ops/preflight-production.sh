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
stack_value() {
      local key="$1"
      if [ "${!key+x}" = x ]; then printf '%s' "${!key}"; else sed -n "s/^${key}=//p" "$STACK_DIR/.env" | tail -1; fi
    }

    check_smtp_endpoint() {
      local host port starttls timeout_seconds
      host="$(stack_value SMTP_HOST)"; port="$(stack_value SMTP_PORT)"; starttls="$(stack_value SMTP_STARTTLS)"
      timeout_seconds="${SMTP_PREFLIGHT_TIMEOUT_SECONDS:-10}"
      [ -n "$host" ] || die "SMTP_HOST es obligatorio para el preflight"
      case "$host" in *[!A-Za-z0-9.-]*|.*|*.|-*|*-) die "SMTP_HOST inválido (solo nombre DNS o IPv4)" ;; esac
      case "$port" in ''|*[!0-9]*) die "SMTP_PORT inválido: debe ser un entero entre 1 y 65535" ;; esac
      [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || die "SMTP_PORT inválido: debe ser un entero entre 1 y 65535"
      case "$timeout_seconds" in ''|*[!0-9]*) die "SMTP_PREFLIGHT_TIMEOUT_SECONDS inválido" ;; esac
      [ "$timeout_seconds" -ge 1 ] || die "SMTP_PREFLIGHT_TIMEOUT_SECONDS debe ser positivo"
      command -v getent >/dev/null 2>&1 || die "falta getent para resolver SMTP_HOST"
      command -v timeout >/dev/null 2>&1 || die "falta timeout para limitar el preflight SMTP"
      getent ahosts "$host" >/dev/null 2>&1 || die "falló la resolución DNS del endpoint SMTP configurado"
      timeout "${timeout_seconds}s" bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$host" "$port" || die "falló o expiró la conexión TCP al endpoint SMTP configurado"
      case "${starttls:-true}" in
        true|TRUE|1|yes|YES) command -v openssl >/dev/null 2>&1 || die "falta openssl para comprobar STARTTLS SMTP"; timeout "${timeout_seconds}s" openssl s_client -starttls smtp -connect "${host}:${port}" -servername "$host" -brief </dev/null >/dev/null 2>&1 || die "falló o expiró el handshake STARTTLS del endpoint SMTP configurado" ;;
        false|FALSE|0|no|NO) ;;
        *) die "SMTP_STARTTLS inválido: use true o false" ;;
      esac
      log "SMTP preflight OK: endpoint TCP/STARTTLS comprobado sin autenticación"
    }

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
check_smtp_endpoint
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
