#!/usr/bin/env bash
# Report whether the newest logical backup is within the declared RPO.
# This check is read-only and provider-neutral: an external monitor or scheduler
# decides how to deliver an alert.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cataclub}"
MAX_AGE_HOURS=26

usage() { echo "uso: check-backup-freshness.sh [--max-age-hours <horas>]" >&2; }
if [ "$#" -gt 0 ]; then
  case "$1" in
    --max-age-hours) MAX_AGE_HOURS="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
fi
[ "$#" -eq 0 ] || { usage; exit 2; }
case "$MAX_AGE_HOURS" in
  ''|*[!0-9]*) echo "ERROR: el umbral debe ser un número entero de horas" >&2; exit 2 ;;
esac

newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'cataclub_*.dump' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2- || true)"
if [ -z "$newest" ]; then
  echo "[$(date '+%F %T')] ALERTA: no hay ningún dump en ${BACKUP_DIR}"
  exit 1
fi

age_hours="$(awk -v now="$(date +%s)" -v mtime="$(stat -c %Y "$newest")" \
  'BEGIN { printf "%.1f", (now - mtime) / 3600 }')"
echo "[$(date '+%F %T')] dump más reciente: ${newest} (hace ${age_hours}h)"
if awk -v age="$age_hours" -v max="$MAX_AGE_HOURS" 'BEGIN { exit !(age > max) }'; then
  echo "ALERTA: el dump supera el umbral de ${MAX_AGE_HOURS}h"
  exit 2
fi
