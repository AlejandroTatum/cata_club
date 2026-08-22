#!/usr/bin/env bash
# Provider-neutral logical PostgreSQL backup. Credentials stay inside the db
# container; this script never exports or prints them. Retention is deliberately
# non-destructive: use provider/object-store lifecycle rules after off-host
# replication is configured.
set -euo pipefail

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

STACK_DIR="${BACKUP_STACK_DIR:-$(pwd)}"
COMPOSE_FILES="${BACKUP_COMPOSE_FILES:--f docker-compose.yml -f docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cataclub}"
RETENTION="${BACKUP_RETENTION:-14}"
case "$RETENTION" in ''|*[!0-9]*) log "ERROR: BACKUP_RETENTION debe ser entero" >&2; exit 2 ;; esac

STAMP="$(date +%F)"
DUMP_TMP="${BACKUP_DIR}/cataclub_${STAMP}.dump.tmp"
DUMP_FINAL="${BACKUP_DIR}/cataclub_${STAMP}.dump"
mkdir -p "$BACKUP_DIR"
trap 'rm -f "$DUMP_TMP"' EXIT
cd "$STACK_DIR"

log "Dump lógico hacia ${DUMP_FINAL}"
# Word splitting is intentional: BACKUP_COMPOSE_FILES is a list of -f flags.
# shellcheck disable=SC2086
docker compose ${COMPOSE_FILES} exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges' > "$DUMP_TMP"
mv -f "$DUMP_TMP" "$DUMP_FINAL"
trap - EXIT
log "Dump OK: $(du -h "$DUMP_FINAL" | cut -f1)"

count="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'cataclub_*.dump' | wc -l)"
if [ "$count" -gt "$RETENTION" ]; then
  log "AVISO: hay ${count} dumps (retención objetivo: ${RETENTION}); no se borra ninguno automáticamente"
fi
log "Backup completo"
