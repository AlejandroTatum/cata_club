#!/usr/bin/env bash
# Alert on memory pressure before the 07:00 heartbeat pings the external
# dead-man's-switch (issue #1071).
#
# Exits 0 only when BOTH hold:
#   - every running container with a declared `mem_limit` is below 90% of it;
#   - the host's available memory (`MemAvailable` in /proc/meminfo) is at or
#     above the threshold (default 256 MiB, override with
#     --min-available-mb).
# Otherwise exits non-zero with one line per offender on stderr.
#
# Same pattern as check-backup-freshness.sh: this check is read-only and
# provider-neutral. It hangs off the same `&&` chain as
# check-backup-freshness.sh, right before notify-heartbeat.sh -- an offender
# here must cut the ping so the ABSENCE of the heartbeat is the alert (see
# docs/operations/monitoring.md).
set -euo pipefail

MEM_PCT_THRESHOLD=90
MIN_AVAILABLE_MB="${MIN_AVAILABLE_MB:-256}"
# Overridable solo para tests: en el host real siempre es /proc/meminfo.
MEMINFO_FILE="${MEMINFO_FILE:-/proc/meminfo}"

usage() { echo "uso: check-memory.sh [--min-available-mb <MiB>]" >&2; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --min-available-mb) MIN_AVAILABLE_MB="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done
case "$MIN_AVAILABLE_MB" in
  ''|*[!0-9]*) echo "ERROR: --min-available-mb debe ser un entero de MiB" >&2; exit 2 ;;
esac

command -v docker >/dev/null 2>&1 || { echo "ERROR: falta 'docker' en el host" >&2; exit 2; }
[ -r "$MEMINFO_FILE" ] || { echo "ERROR: no se pudo leer $MEMINFO_FILE" >&2; exit 2; }

offenders=()

disponible_kb="$(awk '/^MemAvailable:/ { print $2 }' "$MEMINFO_FILE")"
case "$disponible_kb" in
  ''|*[!0-9]*)
    echo "ERROR: no se encontró 'MemAvailable' en $MEMINFO_FILE" >&2
    exit 2
    ;;
esac
disponible_mb=$((disponible_kb / 1024))
if [ "$disponible_mb" -lt "$MIN_AVAILABLE_MB" ]; then
  offenders+=("ALERTA: memoria disponible del host ${disponible_mb}MiB por debajo del umbral ${MIN_AVAILABLE_MB}MiB")
fi

# `docker stats --no-stream` no necesita ningún demonio adicional ni
# dependencia nueva: ya es el binario que el host usa para desplegar. El
# formato pide exactamente Name/MemUsage/MemPerc, separados por tabs.
while IFS=$'\t' read -r nombre uso porcentaje; do
  [ -n "$nombre" ] || continue
  pct="${porcentaje%\%}"
  case "$pct" in
    ''|*[!0-9.]*)
      # Docker reporta MemPerc como "--" cuando el contenedor no tiene
      # `mem_limit`: no hay porcentaje que comparar, así que se salta -- no
      # es un error ni un ofensor.
      continue
      ;;
  esac
  if awk -v p="$pct" -v umbral="$MEM_PCT_THRESHOLD" 'BEGIN { exit !(p >= umbral) }'; then
    offenders+=("ALERTA: '${nombre}' usa ${porcentaje} de su límite (${uso})")
  fi
done < <(docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}')

if [ "${#offenders[@]}" -gt 0 ]; then
  printf '%s\n' "${offenders[@]}" >&2
  exit 1
fi

echo "[$(date '+%F %T')] memoria OK: host con ${disponible_mb}MiB disponibles (umbral ${MIN_AVAILABLE_MB}MiB), ningún contenedor >= ${MEM_PCT_THRESHOLD}% de su límite"
