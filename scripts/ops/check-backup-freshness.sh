#!/usr/bin/env bash
#
# Chequeo de frescura del backup lógico (L2) para el monitoring.
#
# Sale con exit != 0 si el dump más reciente es viejo o no existe: el cron de
# monitoring lo corre y solo avisa cuando la condición se da, en vez de loguear
# aciertos todos los días.
#
# Uso: check-backup-freshness.sh [--max-age-hours 26]
#
# Salidas:
#   0  hay un dump más nuevo que el umbral
#   1  no hay ningún dump
#   2  el dump más nuevo supera el umbral (viejo)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/cataclub}"
MAX_AGE_HOURS="${1:-26}"   # RPO diario (03:30) + margen de 2h por corrida larga

newest="$(find "${BACKUP_DIR}" -maxdepth 1 -name 'cataclub_*.dump' -printf '%T@ %p\n' \
  | sort -rn | head -1 | cut -d' ' -f2- || true)"

if [ -z "${newest}" ]; then
  echo "[$(date '+%F %T')] ALERTA: no hay ningun dump en ${BACKUP_DIR}"
  exit 1
fi

age_hours="$(awk -v now="$(date +%s)" -v mtime="$(stat -c %Y "${newest}")" \
  'BEGIN { printf "%.1f", (now - mtime) / 3600 }')"

echo "[$(date '+%F %T')] dump mas reciente: ${newest} (hace ${age_hours}h)"
if awk -v a="${age_hours}" -v m="${MAX_AGE_HOURS}" 'BEGIN { exit !(a > m) }'; then
  echo "ALERTA: el dump supera el umbral de ${MAX_AGE_HOURS}h"
  exit 2
fi
exit 0