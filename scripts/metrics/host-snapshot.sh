#!/usr/bin/env bash
# Host snapshot for the admin "Actividad del club" screen (issue #1314).
#
# Runs on the HOST every minute (cron) and writes ONE small JSON file:
# CPU %, RAM, swap, disk %, and per-container memory vs limit. The collector
# (celery-worker) reads it through a READ-ONLY bind mount -- that is the whole
# point: the containers cannot see the host, and the Docker socket must never
# be mounted into one to find out. `docker stats` runs here, on the host.
#
# Aggregates only: container names are compose SERVICE names (backend, db, ...),
# never container ids, hostnames, IPs or image versions.
#
# Failure policy: if the host counters cannot be read, exit 2 WITHOUT writing --
# the file then goes stale and the collector reports the host as unavailable
# (>3 min) instead of showing a lie. If only `docker stats` fails, the file is
# still written with an empty container list.
#
# The file is replaced atomically (temp file + rename in the same directory),
# so the collector never reads a half-written JSON.
set -euo pipefail

METRICS_DIR="${METRICS_DIR:-/var/lib/cata-club/metricas}"
PROC_STAT_FILE="${PROC_STAT_FILE:-/proc/stat}"
MEMINFO_FILE="${MEMINFO_FILE:-/proc/meminfo}"
DISK_PATH="${DISK_PATH:-/}"
# Only used when there is no previous sample yet (first run after install).
CPU_SAMPLE_SECONDS="${CPU_SAMPLE_SECONDS:-1}"

OUT_FILE="$METRICS_DIR/host.json"
CPU_PREV_FILE="$METRICS_DIR/.cpu-prev"

die() { echo "ERROR: $*" >&2; exit 2; }

[ -d "$METRICS_DIR" ] || die "no existe $METRICS_DIR (ver docs/operations/metricas.md)"
[ -r "$PROC_STAT_FILE" ] || die "no se pudo leer $PROC_STAT_FILE"
[ -r "$MEMINFO_FILE" ] || die "no se pudo leer $MEMINFO_FILE"

# --- CPU: average over the interval since the previous run ------------------
# "total idle" from the aggregate `cpu` line (idle includes iowait).
read_cpu() {
  awk '/^cpu / { t = 0; for (i = 2; i <= 9; i++) t += $i; print t, $5 + $6; exit }' "$PROC_STAT_FILE"
}
cpu_now="$(read_cpu)"
[ -n "$cpu_now" ] || die "formato inesperado en $PROC_STAT_FILE"
if [ -r "$CPU_PREV_FILE" ] && [ -n "$(cat "$CPU_PREV_FILE")" ]; then
  cpu_prev="$(cat "$CPU_PREV_FILE")"
else
  cpu_prev="$cpu_now"
  if [ "$CPU_SAMPLE_SECONDS" != "0" ]; then
    sleep "$CPU_SAMPLE_SECONDS"
    cpu_now="$(read_cpu)"
  fi
fi
cpu_pct="$(awk -v prev="$cpu_prev" -v now="$cpu_now" 'BEGIN {
  split(prev, p, " "); split(now, n, " ")
  dt = n[1] - p[1]; di = n[2] - p[2]
  if (dt <= 0) { print "0.0"; exit }
  pct = 100 * (dt - di) / dt
  if (pct < 0) pct = 0; if (pct > 100) pct = 100
  printf "%.1f", pct
}')"
printf '%s\n' "$cpu_now" > "$CPU_PREV_FILE"

# --- RAM / swap (MiB) -------------------------------------------------------
mem_line() { awk -v k="$1" '$1 == k":" { print $2; exit }' "$MEMINFO_FILE"; }
mem_total_kb="$(mem_line MemTotal)"; mem_avail_kb="$(mem_line MemAvailable)"
swap_total_kb="$(mem_line SwapTotal)"; swap_free_kb="$(mem_line SwapFree)"
for v in "$mem_total_kb" "$mem_avail_kb" "$swap_total_kb" "$swap_free_kb"; do
  case "$v" in ''|*[!0-9]*) die "faltan campos en $MEMINFO_FILE" ;; esac
done
ram_total_mb=$((mem_total_kb / 1024))
ram_used_mb=$(((mem_total_kb - mem_avail_kb) / 1024))
swap_total_mb=$((swap_total_kb / 1024))
swap_used_mb=$(((swap_total_kb - swap_free_kb) / 1024))

# --- Disk -------------------------------------------------------------------
disk_pct="$(df -P "$DISK_PATH" | awk 'NR == 2 { gsub("%", "", $5); print $5 }')"
case "$disk_pct" in ''|*[!0-9]*) die "no se pudo leer el uso de disco de $DISK_PATH" ;; esac

# --- Containers (compose service name, MiB used / MiB limit) ---------------
# `docker ps` maps container id -> compose service; `docker stats` gives memory.
# Units -> MiB. Containers with no limit report a limit equal to the host RAM,
# which would be a lie in the bar: those are skipped (limit 0 or ~host RAM;
# docker prints GiB with 3-4 digits, hence the 97% tolerance).
containers_json="[]"
if command -v docker >/dev/null 2>&1; then
  services="$(docker ps --format '{{.ID}}	{{index .Labels "com.docker.compose.service"}}' 2>/dev/null || true)"
  stats="$(docker stats --no-stream --format '{{.ID}}	{{.MemUsage}}' 2>/dev/null || true)"
  if [ -n "$services" ] && [ -n "$stats" ]; then
    containers_json="$(awk -F'\t' -v ram_total_mb="$ram_total_mb" '
      function to_mb(v,   n, u) {
        n = v + 0
        u = v; gsub(/[0-9.]/, "", u)
        if (u == "B") return n / 1048576
        if (u == "KiB" || u == "kB") return n / 1024
        if (u == "MiB" || u == "MB") return n
        if (u == "GiB" || u == "GB") return n * 1024
        return -1
      }
      FNR == NR { svc[$1] = $2; next }
      ($1 in svc) && svc[$1] != "" {
        split($2, partes, " / ")
        used = to_mb(partes[1]); limit = to_mb(partes[2])
        if (used < 0 || limit <= 0 || limit >= ram_total_mb * 0.97) next
        item = sprintf("{\"nombre\":\"%s\",\"usado_mb\":%d,\"limite_mb\":%d}", svc[$1], used + 0.5, limit + 0.5)
        salida = (salida == "" ? item : salida "," item)
      }
      END { print "[" salida "]" }
    ' <(printf '%s\n' "$services") <(printf '%s\n' "$stats"))"
  fi
fi

# --- Write atomically -------------------------------------------------------
tmp="$(mktemp "$METRICS_DIR/.host.json.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
printf '{"version":1,"escrito_en":%s,"cpu_pct":%s,"ram_usada_mb":%s,"ram_total_mb":%s,"swap_usada_mb":%s,"swap_total_mb":%s,"disco_pct":%s,"contenedores":%s}\n' \
  "$(date +%s)" "$cpu_pct" "$ram_used_mb" "$ram_total_mb" "$swap_used_mb" "$swap_total_mb" "$disk_pct" "$containers_json" > "$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$OUT_FILE"
trap - EXIT
