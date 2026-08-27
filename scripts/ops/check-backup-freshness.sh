#!/usr/bin/env bash
# Report whether the newest logical backup is within the declared RPO.
# This check is read-only and provider-neutral: an external monitor or scheduler
# decides how to deliver an alert.
#
# BACKUP_TOLERATE_MISSING=1 downgrades only the "no dump at all" alert to a
# warning (exit 0): deploy.sh exports it on the very first provision, where the
# database has never started and no backup can exist. A stale dump still alerts.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cataclub}"
MAX_AGE_HOURS=26
TOLERATE_MISSING="${BACKUP_TOLERATE_MISSING:-0}"
case "$TOLERATE_MISSING" in
  0|1) ;;
  *) echo "ERROR: BACKUP_TOLERATE_MISSING debe ser 0 o 1" >&2; exit 2 ;;
esac

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

# Cuenta las DOS formas del artefacto: `cataclub_*.dump.age` es el backup
# cifrado que produce backup-db.sh, y `cataclub_*.dump` son los dumps en claro
# anteriores al cifrado. Mirar solo el glob viejo dejaria este chequeo
# alertando "no hay ningun dump" todas las noches con el backup andando —
# monitoreo apagado por un cambio de nombre, que es la peor forma de apagarlo.
newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'cataclub_*.dump' -o -name 'cataclub_*.dump.age' \) -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2- || true)"
if [ -z "$newest" ]; then
  if [ "$TOLERATE_MISSING" = "1" ]; then
    echo "[$(date '+%F %T')] AVISO: no hay ningún dump en ${BACKUP_DIR} (tolerado: primer aprovisionamiento)"
    exit 0
  fi
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
