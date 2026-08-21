#!/usr/bin/env bash
#
# Despliegue reproducible del stack de producción — automatiza el runbook
# docs/operations/deployment.md. NUNCA usa `latest`: exige IMAGE_TAG con un SHA
# inmutable de GHCR.
#
# Uso:
#   deploy.sh                      desplegar IMAGE_TAG + validar todo
#   deploy.sh checks               solo las validaciones post-despliegue
#   deploy.sh install-cron         instalar el cron del backup lógico (1 vez)
#
# Requiere (ver docs/operations/provisioning.md):
#   - `docker` + plugin compose en el host
#   - `.env` en STACK_DIR (chmod 600) con las variables de producción
#   - `IMAGE_TAG=<sha>` exportado (o en el .env)
#   - acceso autenticado a GHCR (paquetes privados)
#
# Exit code != 0 en el primer paso que falle: el deploy se aborta.

set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

STACK_DIR="${STACK_DIR:-/opt/cata-club}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cataclub}"
BACKUP_CRON_LOG="/var/log/cataclub-backup.log"

cmd="${1:-deploy}"

case "${cmd}" in
  deploy|checks|install-cron) ;;
  *) die "subcomando desconocido: ${cmd} (deploy | checks | install-cron)" ;;
esac

cd "${STACK_DIR}"

# deploy/checks tocan el stack: necesitan el .env de producción y un SHA
# inmutable. install-cron no: solo escribe la entrada del crontab.
if [ "${cmd}" != "install-cron" ]; then
  [ -f .env ] || die "no hay .env en ${STACK_DIR} (ver provisioning.md)"

  # Lee IMAGE_TAG del .env si no está exportado; rechaza 'latest' (el tag por
  # defecto de Compose no es un SHA desplegable).
  if [ -z "${IMAGE_TAG:-}" ]; then
    IMAGE_TAG="$(grep -E '^IMAGE_TAG=' .env | head -1 | cut -d= -f2- || true)"
  fi
  case "${IMAGE_TAG}" in
    ""|latest) die "IMAGE_TAG no definido o 'latest': fijar el SHA inmutable a desplegar" ;;
  esac
fi

check_remote_image() {
  docker manifest inspect "ghcr.io/alejandrotatum/cata_club-backend:${IMAGE_TAG}" \
    >/dev/null 2>&1 \
    || die "la imagen ghcr.io/alejandrotatum/cata_club-backend:${IMAGE_TAG} no existe (¿logueado a GHCR?)"
}

do_checks() {
  log "Validacion 1: servicios running/healthy"
  docker compose "${COMPOSE_FILES[@]}" ps -a

  log "Validacion 2: sondas del backend (dentro del contenedor; prod no expone 8000)"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend \
    python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=5).read().decode())"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend \
    python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).read().decode())"

  log "Validacion 3: /docs apagado en produccion (debe dar 404)"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend \
    python -c "import urllib.request, urllib.error
try: urllib.request.urlopen('http://127.0.0.1:8000/docs', timeout=5)
except urllib.error.HTTPError as e: print(e.code)
else: raise SystemExit('ERROR: /docs responde')"

  log "Validacion 4: dump logico del dia existe (backup L2)"
  today="$(date +%F)"
  ls -lh "${BACKUP_DIR}/cataclub_${today}.dump"

  log "TODAS LAS VALIDACIONES OK"
}

case "${cmd}" in
  deploy)
    check_remote_image
    log "Desplegando ghcr.io/alejandrotatum/cata_club-*:${IMAGE_TAG}"
    docker compose "${COMPOSE_FILES[@]}" pull
    docker compose "${COMPOSE_FILES[@]}" up -d
    do_checks
    ;;
  checks)
    do_checks
    ;;
  install-cron)
    # Idempotente: si la línea ya existe, no la duplica. El cron corre como root
    # porque necesita el socket de docker y escribir en /var/backups.
    log "Instalando cron del backup logico (03:30)"
    (crontab -l 2>/dev/null | grep -v 'backup-db.sh' || true
     printf '30 3 * * * cd %s && ./scripts/backup/backup-db.sh >> %s 2>&1\n' "${STACK_DIR}" "${BACKUP_CRON_LOG}"
    ) | crontab -
    crontab -l | grep 'backup-db.sh' >/dev/null \
      || die "el cron no quedo instalado"
    log "Cron instalado: $(crontab -l | grep 'backup-db.sh')"
    ;;
  *)
    die "no deberia llegar aca"
    ;;
esac