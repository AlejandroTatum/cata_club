#!/usr/bin/env bash
#
# Backup lógico diario de la base del stack (capa L2 del runbook de backup;
# L1 son los backups de disco de DigitalOcean ya contratados).
#
# - Saca un dump en formato custom (comprimido) del servicio `db` con las
#   credenciales DENTRO del contenedor: ningún secreto vive en este script ni
#   en el cron.
# - Escribe de forma atómica (tmp + mv): un dump fallido nunca deja un archivo
#   que parezca válido.
# - Rota conservando los ultimos ${BACKUP_RETENTION} dumps.
#
# Uso: backup-db.sh
#
# Variables de entorno (todas con default util):
#   BACKUP_DIR           directorio de destino (default: /var/backups/cataclub)
#   BACKUP_STACK_DIR     dir con los archivos de compose (default: cwd)
#   BACKUP_COMPOSE_FILES los -f de compose (default: capa de produccion)
#   BACKUP_RETENTION     dumps a conservar (default: 14)
#
# Exit code != 0 si algo falla: el cron lo loguea y el monitoreo lo ve.

set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

STACK_DIR="${BACKUP_STACK_DIR:-$(pwd)}"
COMPOSE_FILES="${BACKUP_COMPOSE_FILES:--f docker-compose.yml -f docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cataclub}"
RETENTION="${BACKUP_RETENTION:-14}"

STAMP="$(date +%F)"
DUMP_TMP="${BACKUP_DIR}/cataclub_${STAMP}.dump.tmp"
DUMP_FINAL="${BACKUP_DIR}/cataclub_${STAMP}.dump"

mkdir -p "${BACKUP_DIR}"
cd "${STACK_DIR}"

log "Dump logico de la base (${STAMP}) hacia ${DUMP_FINAL}"

# Word splitting intencional de COMPOSE_FILES (lista de -f).
# shellcheck disable=SC2086
docker compose ${COMPOSE_FILES} exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --format=custom --no-owner --no-privileges' \
  > "${DUMP_TMP}"

mv -f "${DUMP_TMP}" "${DUMP_FINAL}"
log "Dump OK: $(du -h "${DUMP_FINAL}" | cut -f1)"

log "Rotacion: conservando los ultimos ${RETENTION} dumps"
find "${BACKUP_DIR}" -maxdepth 1 -name 'cataclub_*.dump' -print \
  | sort -r \
  | tail -n +$((RETENTION + 1)) \
  | while read -r old; do
      rm -f "${old}"
      log "Descartado: ${old}"
    done

log "Backup completo"