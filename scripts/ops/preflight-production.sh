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
# Mismo default que scripts/ops/record-release.sh:11 y
# scripts/ops/rollback-release.sh:18: los tres tienen que mirar el mismo
# directorio para que "current.env" signifique lo mismo en los tres.
RELEASE_RECORD_DIR="${RELEASE_RECORD_DIR:-/var/lib/cata-club/releases}"
CURRENT_RELEASE_RECORD="$RELEASE_RECORD_DIR/current.env"

[ -d "$STACK_DIR" ] || die "STACK_DIR no existe: $STACK_DIR"
[ -f "$STACK_DIR/.env" ] || die "falta $STACK_DIR/.env"
if [ -z "$IMAGE_TAG" ]; then
  IMAGE_TAG="$(sed -n 's/^IMAGE_TAG=//p' "$STACK_DIR/.env" | head -1)"
  export IMAGE_TAG
fi
ENV_IMAGE_TAG="$(sed -n 's/^IMAGE_TAG=//p' "$STACK_DIR/.env" | head -1)"
[ "$ENV_IMAGE_TAG" = "$IMAGE_TAG" ] \
  || die "${STACK_DIR}/.env IMAGE_TAG=${ENV_IMAGE_TAG:-vacío} no coincide con IMAGE_TAG=${IMAGE_TAG}"
CHECKOUT_HEAD="$(git -C "$STACK_DIR" rev-parse --verify HEAD 2>/dev/null)" || die "no se pudo leer Git HEAD del checkout en ${STACK_DIR}"
[ "$CHECKOUT_HEAD" = "$IMAGE_TAG" ] || die "Git HEAD=${CHECKOUT_HEAD} no coincide con IMAGE_TAG=${IMAGE_TAG}"
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

# --- Derivación del estado real de Alembic (issue #805) ---------------------
# Hasta acá, la aprobación de migración manual se comparaba contra literales
# de UN despliegue puntual: el próximo deploy con migraciones distintas fallaba
# siempre, y la salida obvia (editar los literales a mano) volvía la
# aprobación ceremonia. Lo que sigue deriva la revisión desplegada y las
# migraciones pendientes del estado real en vez de recordarlas.
#
# La revisión desplegada se lee de `alembic_version` en la base productiva,
# siguiendo el mismo patrón que scripts/backup/restore-check.sh:135-137 (que
# ya lee esa tabla) y scripts/backup/backup-db.sh:153 (que ya opera el
# servicio `db` con `docker compose exec -T db sh -c '...'`).
#
# Las migraciones pendientes se derivan corriendo Alembic DENTRO de la imagen
# que se va a desplegar, con el mismo invocador que usa el contenedor en
# producción (`uv run --frozen --no-build alembic ...`, ver
# backend/scripts/entrypoint.sh:20). `alembic history` sin `--indicate-current`
# nunca ejecuta `backend/alembic/env.py` (que es lo único que abre una
# conexión a la base), así que esto corre sin exponerle credenciales de base
# de datos a la imagen ni tocar la base desplegada por segunda vez.
#
# `db` no corriendo NO prueba por sí solo que sea un primer aprovisionamiento:
# una base caída (crash, OOM, reinicio a mitad de camino, mal configurada)
# toma la misma rama, y no hay nada en "db no responde" que distinga esos dos
# casos. La señal real es si YA existe un release registrado para este stack:
# `record-release.sh` (scripts/ops/record-release.sh:44-46) escribe
# "${RELEASE_RECORD_DIR}/current.env" en cada deploy exitoso, y
# `rollback-release.sh:24` ya lo lee como el registro autoritativo del último
# release. Si ese archivo existe, hubo un deploy previo: la base tiene que
# estar arriba, y que no lo esté es una falla, no un primer aprovisionamiento.
# Si no existe, no hay evidencia de ningún release previo: recién ahí se
# asume primer aprovisionamiento, con el mismo criterio que
# `BACKUP_TOLERATE_MISSING` ya usa para el backup pre-deploy.
release_previo_registrado() {
  [ -f "$CURRENT_RELEASE_RECORD" ]
}

db_esta_corriendo() {
  local running
  running="$(
    cd "$STACK_DIR"
    docker compose -f docker-compose.yml -f docker-compose.prod.yml \
      ps --status running --services 2>/dev/null || true
  )"
  printf '%s\n' "$running" | grep -qx 'db'
}

# Única resolución de la imagen backend del preflight: la usan tanto la
# derivación de migraciones (que se la pasa a `docker run`) como la
# verificación final de IMAGE_REFERENCE.
#
# `config --images backend` NO devuelve una sola línea (issue #846): Compose
# expande el servicio a su grafo de dependencias, y `backend` declara
# `depends_on: db, redis` (docker-compose.yml:73-77), así que esa salida trae
# siempre postgres y redis además de la imagen que se va a desplegar. Pasarla
# entera a `docker run` es el `docker: invalid reference format` que abortó el
# preflight de staging antes de desplegar.
#
# `deploy.sh:27-41` ya había resuelto exactamente esto (issue #747): se le
# pregunta a Compose QUÉ imagen usa el servicio `backend`, que devuelve una
# sola referencia por construcción en vez de obligar a elegir una línea de una
# lista. Elegir la primera o la última sería adivinar; acá cualquier salida de
# la que no salga exactamente una referencia utilizable muere.
resolver_imagen_backend() {
  local ref
  command -v docker >/dev/null 2>&1 || die "docker no está disponible"
  docker compose version >/dev/null || die "docker compose no está disponible"
  command -v python3 >/dev/null 2>&1 || die "falta python3 para resolver la imagen backend"
  ref="$(
    cd "$STACK_DIR"
    IMAGE_TAG="$IMAGE_TAG" docker compose -f docker-compose.yml -f docker-compose.prod.yml \
      config --format json | python3 -c 'import json, sys
try:
    services = json.load(sys.stdin).get("services")
    image = services["backend"]["image"] if isinstance(services, dict) and isinstance(services.get("backend"), dict) else None
    if not isinstance(image, str) or not image or "\n" in image or "\r" in image:
        raise ValueError
    print(image)
except (ValueError, KeyError, TypeError, json.JSONDecodeError):
    sys.exit(1)'
  )" || die "Compose no resolvió exactamente una imagen para backend"
  [ -n "$ref" ] || die "Compose no resolvió exactamente una imagen para backend"
  case "$ref" in
    *":${IMAGE_TAG}") ;;
    *) die "la imagen backend configurada no usa IMAGE_TAG=${IMAGE_TAG}" ;;
  esac
  printf '%s' "$ref"
}

# Deja CURRENT_REVISION, PENDING_MIGRATIONS_LIST (una por línea, de la más
# vieja a la más nueva), PENDING_MIGRATIONS_CSV y MIGRATION_RANGE_DERIVADO
# (current->pendiente1->pendiente2->...) derivados del estado real. Cualquier
# falla en la derivación es fatal: no hay un valor "seguro" para adivinar acá.
derivar_estado_migraciones() {
  local imagen raw heads_output head_count head_revision history_output

  imagen="$(resolver_imagen_backend)"

  raw="$(
    cd "$STACK_DIR"
    docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db \
      sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT version_num FROM alembic_version;"'
  )" || die "no se pudo derivar la revisión desplegada: no se pudo leer alembic_version de la base"
  CURRENT_REVISION="$(printf '%s' "$raw" | tr -d '[:space:]')"
  [ -n "$CURRENT_REVISION" ] || die "no se pudo derivar la revisión desplegada: alembic_version devolvió vacío"

  heads_output="$(docker run --rm "$imagen" uv run --frozen --no-build alembic heads)" \
    || die "no se pudo derivar las migraciones pendientes: Alembic no pudo listar los heads en la imagen ${imagen}"
  head_count="$(printf '%s\n' "$heads_output" | grep -c . || true)"
  [ "$head_count" -eq 1 ] || die "no se pudo derivar las migraciones pendientes: Alembic reporta ${head_count} heads en la imagen, el rango no es único"
  head_revision="$(printf '%s' "$heads_output" | awk '{print $1}')"

  if [ "$CURRENT_REVISION" = "$head_revision" ]; then
    PENDING_MIGRATIONS_LIST=""
  else
    history_output="$(docker run --rm "$imagen" uv run --frozen --no-build alembic history -r "${CURRENT_REVISION}:heads")" \
      || die "no se pudo derivar las migraciones pendientes desde ${CURRENT_REVISION}: Alembic no localizó esa revisión en la imagen ${imagen}"
    PENDING_MIGRATIONS_LIST="$(
      printf '%s\n' "$history_output" \
        | awk -F' -> ' '{print $2}' \
        | awk -F'[, ]' '{print $1}' \
        | tac \
        | awk -v cur="$CURRENT_REVISION" '$0 != cur'
    )"
    [ -n "$PENDING_MIGRATIONS_LIST" ] || die "no se pudo derivar las migraciones pendientes: Alembic no reportó ninguna entre ${CURRENT_REVISION} y ${head_revision}"
  fi

  PENDING_MIGRATIONS_CSV="$(printf '%s' "$PENDING_MIGRATIONS_LIST" | tr '\n' ',' | sed 's/,$//')"
  MIGRATION_RANGE_DERIVADO="$CURRENT_REVISION"
  if [ -n "$PENDING_MIGRATIONS_LIST" ]; then
    while IFS= read -r rev; do
      MIGRATION_RANGE_DERIVADO="${MIGRATION_RANGE_DERIVADO}->${rev}"
    done < <(printf '%s\n' "$PENDING_MIGRATIONS_LIST")
  fi
}

case "$MIGRATION_COMPATIBILITY" in
  none|backward-compatible)
        if db_esta_corriendo; then
          derivar_estado_migraciones
          if [ "$MIGRATION_COMPATIBILITY" = "none" ] && [ -n "$PENDING_MIGRATIONS_LIST" ]; then
            die "MIGRATION_COMPATIBILITY=none pero hay migraciones pendientes reales (${PENDING_MIGRATIONS_CSV}); declarar backward-compatible o manual-review-required"
          fi
          if [ "$MIGRATION_COMPATIBILITY" = "backward-compatible" ]; then
            log "backward-compatible: Alembic no puede verificar automáticamente que un downgrade sea seguro; queda atestiguado por quien despliega. Rango real derivado: ${MIGRATION_RANGE_DERIVADO}"
          fi
        elif release_previo_registrado; then
          die "el servicio db no está corriendo, pero hay un release previo registrado en ${CURRENT_RELEASE_RECORD}: la base debería estar arriba y no lo está"
        else
          log "AVISO: el servicio db no está corriendo y no hay ningún release previo registrado en ${CURRENT_RELEASE_RECORD}; se asume primer aprovisionamiento y se omite la validación de migraciones para ${MIGRATION_COMPATIBILITY}"
        fi
        ;;
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
        db_esta_corriendo || die "manual-review-required exige derivar el rango real de migraciones, pero el servicio db no está corriendo"
        derivar_estado_migraciones
        [ -n "$PENDING_MIGRATIONS_LIST" ] || die "no hay migraciones pendientes reales; manual-review-required no corresponde sin migraciones pendientes"
        [ "$(approval_value MIGRATION_RANGE)" = "$MIGRATION_RANGE_DERIVADO" ] || die "la aprobación no corresponde al rango de migración real (derivado: ${MIGRATION_RANGE_DERIVADO})"
        [ "$(approval_value CURRENT_REVISION)" = "$CURRENT_REVISION" ] || die "la aprobación no corresponde a la revisión desplegada real (${CURRENT_REVISION})"
        [ "$(approval_value PENDING_MIGRATIONS)" = "$PENDING_MIGRATIONS_CSV" ] || die "la aprobación no corresponde a las migraciones pendientes reales (${PENDING_MIGRATIONS_CSV})"
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
        log "Aprobación manual válida para ${IMAGE_TAG} y el rango de migración real ${MIGRATION_RANGE_DERIVADO}"
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
# Misma resolución que usa la derivación de migraciones, no una copia: el
# parseo duplicado era lo que dejaba que este camino reportara postgres y redis
# como si fueran la imagen a desplegar cuando `db` no estaba corriendo y
# `derivar_estado_migraciones` no llegaba a correr (issue #846).
IMAGE_REFERENCE="$(resolver_imagen_backend)"
"$SCRIPT_DIR/check-backup-freshness.sh" --max-age-hours "${BACKUP_MAX_AGE_HOURS:-26}"
log "Preflight OK: ${IMAGE_REFERENCE}; migración declarada ${MIGRATION_COMPATIBILITY}"
