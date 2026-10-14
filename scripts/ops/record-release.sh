#!/usr/bin/env bash
# Persist only non-secret release metadata used by the guarded rollback command.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

IMAGE_TAG="${IMAGE_TAG:-}"
APP_VERSION="${APP_VERSION:-}"
MIGRATION_COMPATIBILITY="${MIGRATION_COMPATIBILITY:-}"
STACK_DIR="${STACK_DIR:-/opt/cata-club}"
RELEASE_RECORD_DIR="${RELEASE_RECORD_DIR:-/var/lib/cata-club/releases}"

case "$IMAGE_TAG" in
  ''|latest|*[!0-9a-fA-F]*) die "IMAGE_TAG debe ser un SHA hexadecimal inmutable, nunca latest" ;;
esac
# Misma fuente que `deploy.sh`: el entorno primero y, si no, el `.env` del host.
if [ -z "$APP_VERSION" ] && [ -f "$STACK_DIR/.env" ]; then
  APP_VERSION="$(sed -n 's/^APP_VERSION=//p' "$STACK_DIR/.env" | head -1)"
fi
[[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || die "APP_VERSION='${APP_VERSION:-vacía}' debe ser MAJOR.MINOR.PATCH (solo dígitos, sin 'v'); calculala con 'make release-version SHA=<sha>'"
case "$MIGRATION_COMPATIBILITY" in
  none|backward-compatible|manual-review-required) ;;
  *) die "MIGRATION_COMPATIBILITY debe ser none, backward-compatible o manual-review-required" ;;
esac

[ -d "$STACK_DIR" ] || die "STACK_DIR no existe: $STACK_DIR"
command -v docker >/dev/null 2>&1 || die "docker no está disponible"
docker compose version >/dev/null || die "docker compose no está disponible"
command -v python3 >/dev/null 2>&1 || die "falta python3 para resolver la imagen backend"

# `config --images backend` NO devuelve una sola línea (issue #847): Compose
# expande el servicio a su grafo de dependencias, y `backend` declara
# `depends_on: db, redis` (docker-compose.yml:73-77), así que esa salida trae
# siempre postgres y redis además de la imagen desplegada. El `case` que había
# acá ACEPTABA ese bloque -- `*$'\n'*` estaba en el arm que pasa --, así que el
# registro quedaba con un `IMAGE_REFERENCE=postgres:16-alpine` seguido de dos
# líneas sueltas, y `rollback-release.sh` lo lee como autoritativo.
#
# Se resuelve igual que en `deploy.sh` (issue #747) y en
# `preflight-production.sh` (issue #846): se le pregunta a Compose QUÉ imagen
# usa el servicio `backend`, que devuelve una sola referencia por construcción
# en vez de obligar a elegir una línea de una lista. Elegir la primera o la
# última sería adivinar; acá cualquier salida de la que no salga exactamente
# una referencia utilizable muere.
#
# La resolución y su validación corren ANTES del `mkdir` y de escribir nada:
# un release que no se puede identificar no deja registro a medias.
IMAGE_REFERENCE="$(
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
[ -n "$IMAGE_REFERENCE" ] || die "Compose no resolvió exactamente una imagen para backend"
case "$IMAGE_REFERENCE" in
  *":${IMAGE_TAG}") ;;
  *) die "la imagen backend configurada no usa IMAGE_TAG=${IMAGE_TAG}" ;;
esac

[ -f "$STACK_DIR/.env" ] || die "falta $STACK_DIR/.env para persistir IMAGE_TAG=${IMAGE_TAG}"
# Reescribe IMAGE_TAG y APP_VERSION en el `.env` del host (una sola vez cada una,
# al final si no estaban) y deja el resto del archivo intacto.
persist_project_env() {
  local tmp
  tmp="$(mktemp "$STACK_DIR/.env.release.XXXXXX")" \
    || die "no se pudo preparar ${STACK_DIR}/.env para persistir IMAGE_TAG=${IMAGE_TAG} y APP_VERSION=${APP_VERSION}"
  trap 'rm -f "$tmp"' EXIT
  awk -v tag="$IMAGE_TAG" -v version="$APP_VERSION" '
    BEGIN { found_tag = 0; found_version = 0 }
    /^IMAGE_TAG=/ {
      if (!found_tag) { print "IMAGE_TAG=" tag; found_tag = 1 }
      next
    }
    /^APP_VERSION=/ {
      if (!found_version) { print "APP_VERSION=" version; found_version = 1 }
      next
    }
    { print }
    END {
      if (!found_tag) print "IMAGE_TAG=" tag
      if (!found_version) print "APP_VERSION=" version
    }
  ' "$STACK_DIR/.env" > "$tmp" \
    || die "no se pudo escribir ${STACK_DIR}/.env para persistir IMAGE_TAG=${IMAGE_TAG} y APP_VERSION=${APP_VERSION}"
  chmod 600 "$tmp"
  mv -f "$tmp" "$STACK_DIR/.env"
  trap - EXIT
}
persist_project_env

mkdir -p "$RELEASE_RECORD_DIR"
[ -d "$RELEASE_RECORD_DIR" ] || die "RELEASE_RECORD_DIR no es un directorio: $RELEASE_RECORD_DIR"
tmp="$(mktemp "$RELEASE_RECORD_DIR/.release.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
{
  printf 'IMAGE_TAG=%s\n' "$IMAGE_TAG"
  printf 'IMAGE_REFERENCE=%s\n' "$IMAGE_REFERENCE"
  printf 'APP_VERSION=%s\n' "$APP_VERSION"
  printf 'MIGRATION_COMPATIBILITY=%s\n' "$MIGRATION_COMPATIBILITY"
  printf 'RECORDED_AT=%s\n' "$(date -u '+%FT%TZ')"
} > "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$RELEASE_RECORD_DIR/${IMAGE_TAG}.env"
cp "$RELEASE_RECORD_DIR/${IMAGE_TAG}.env" "$RELEASE_RECORD_DIR/current.env"
chmod 600 "$RELEASE_RECORD_DIR/current.env"
trap - EXIT
log "Release registrada: ${IMAGE_TAG} v${APP_VERSION} (${MIGRATION_COMPATIBILITY})"
