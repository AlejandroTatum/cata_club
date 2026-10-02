#!/usr/bin/env bash
# Host-side resource monitor for the local QA load runs (tracker T4).
#
#   Usage: monitor_resources.sh <RUN_DIR>
#
# While a k6 run is in flight (the runner writes its PID into
# <RUN_DIR>/k6.pid and a stop file when the run ends), this samples, every
# LOAD_MONITOR_INTERVAL seconds (default 10):
#
#   - backend + db containers: CPU %, memory (docker stats --no-stream)
#   - backend container: RestartCount / OOMKilled / Running (docker inspect)
#   - QA db: pg_stat_activity connections vs max_connections
#   - the three durable outboxes: oldest-PENDIENTE age in seconds
#     (enrollment_notificacion_outbox, recuperacion_outbox,
#     verificacion_correo_outbox — the tables the backend actually uses)
#
# Samples append to <RUN_DIR>/resources.jsonl (one JSON object per line).
#
# ABORT WIRING (provisional tracker thresholds) — enforced HERE, on the host:
#   - backend container restarted, OOM-killed, or stopped   → abort now
#   - connections >= 90% of max_connections for 3 consecutive
#     samples (≈ pool exhaustion)                           → abort
#   - any outbox oldest-pending age > LOAD_OUTBOX_ABORT_SECONDS
#     (default 300) for 6 consecutive samples ("growing without
#     bound" proxy)                                         → abort
# An abort writes the reason to <RUN_DIR>/abort.txt and SIGTERMs k6. CPU and
# memory are OBSERVED ONLY: they are evidence, never abort inputs.
#
# Note the division of labor, so no one credits k6 with what the monitor does
# or vice versa: k6 aborts on ITS OWN thresholds (error rate, p95 — abortOnFail
# in the scenario files); this monitor aborts on the EXTERNAL resource signals
# k6 cannot see. Docs/operations/load-testing.md records the exact semantics.
set -uo pipefail

RUN_DIR="${1:?uso: monitor_resources.sh <RUN_DIR>}"
INTERVAL="${LOAD_MONITOR_INTERVAL:-10}"
POOL_LIMIT_PCT="${LOAD_POOL_ABORT_PCT:-90}"
POOL_CONSECUTIVO="${LOAD_POOL_ABORT_SAMPLES:-3}"
OUTBOX_LIMITE="${LOAD_OUTBOX_ABORT_SECONDS:-300}"
OUTBOX_CONSECUTIVO="${LOAD_OUTBOX_ABORT_SAMPLES:-6}"

PID_FILE="$RUN_DIR/k6.pid"
STOP_FILE="$RUN_DIR/stop"
ABORT_FILE="$RUN_DIR/abort.txt"
JSONL="$RUN_DIR/resources.jsonl"

PROYECTO_QA="cataclub-qa" # name: en docker-compose.qa.yml

consec_pool=0
consec_outbox=0
restarts_base=""

# ── Carrera de arranque cerrada: sin k6.pid no hay enforcement ───────────
# El monitor arranca ANTES que k6 (para no perder el primer intervalo de
# muestras), así que espera —acotado— a que el runner escriba k6.pid. Sin
# pid disponible, abortar() no podría cortar k6: por eso el enforcement no
# comienza hasta que el pid existe. Si llega el stop file (corrida ya
# terminada, p. ej. k6 murió al arrancar) o vence la espera, no se vigila.
esperar_pid_de_k6() {
  local limite="${LOAD_PID_WAIT_SECONDS:-900}"
  local intento=0
  local maximo=$((limite * 10)) # pasos de 0.1 s
  while [ ! -s "$PID_FILE" ]; do
    if [ -f "$STOP_FILE" ]; then
      echo "monitor: la corrida terminó antes de escribir k6.pid; nada que vigilar" >&2
      return 1
    fi
    intento=$((intento + 1))
    if [ "$intento" -ge "$maximo" ]; then
      echo "monitor: k6.pid no apareció en ${limite}s (¿docker pull lento del primer arranque?); sigo sin enforcement de host. Ampliá la espera con LOAD_PID_WAIT_SECONDS." >&2
      return 1
    fi
    sleep 0.1
  done
  return 0
}

if ! esperar_pid_de_k6; then
  exit 0
fi

abortar() {
  local motivo="$1"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$motivo" >>"$ABORT_FILE"
  if [ -f "$PID_FILE" ]; then
    K6_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$K6_PID" ] && kill -TERM "$K6_PID" 2>/dev/null || true
  fi
  echo "ABORT: $motivo" >&2
}

# Contenedores del proyecto QA por label (no requiere interpolar Compose).
cid_de() {
  # -a: un backend DETENIDO pierde su id con `docker ps` a secas y el
  # aborto por State.Running=false jamás se vería.
  docker ps -a -q \
    --filter "label=com.docker.compose.project=$PROYECTO_QA" \
    --filter "label=com.docker.compose.service=$1" 2>/dev/null | head -n1
}

while [ ! -f "$STOP_FILE" ]; do
  BACKEND_CID="$(cid_de backend)"
  DB_CID="$(cid_de db)"

  # ── Credenciales de la BD desde el entorno del contenedor (nunca versionadas)
  DB_USER=""
  DB_NAME=""
  if [ -n "$DB_CID" ]; then
    DB_USER="$(docker exec "$DB_CID" printenv POSTGRES_USER 2>/dev/null || echo usuario)"
    DB_NAME="$(docker exec "$DB_CID" printenv POSTGRES_DB 2>/dev/null || echo cataclub_db)"
  fi

  # ── Salud del contenedor backend ──
  RESTARTS=""
  OOM=""
  RUNNING=""
  if [ -n "$BACKEND_CID" ]; then
    IFS='|' read -r RESTARTS OOM RUNNING \
      < <(docker inspect -f '{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Running}}' "$BACKEND_CID" 2>/dev/null || echo "||")
  fi

  # ── CPU / memoria (solo observación) ──
  STATS_BACKEND=""
  STATS_DB=""
  if [ -n "$BACKEND_CID" ]; then
    STATS_BACKEND="$(docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}' "$BACKEND_CID" 2>/dev/null || true)"
  fi
  if [ -n "$DB_CID" ]; then
    STATS_DB="$(docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}' "$DB_CID" 2>/dev/null || true)"
  fi

  # ── Conexiones de BD y outboxes ──
  CONN=""
  MAXCONN=""
  OUTBOX_ENROLL=""
  OUTBOX_RECUP=""
  OUTBOX_VERIF=""
  if [ -n "$DB_CID" ] && [ -n "$DB_USER" ]; then
    CONN="$(docker exec "$DB_CID" psql -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT count(*) FROM pg_stat_activity' 2>/dev/null || true)"
    MAXCONN="$(docker exec "$DB_CID" psql -U "$DB_USER" -d "$DB_NAME" -tAc 'SHOW max_connections' 2>/dev/null || true)"
    OUTBOX_ENROLL="$(docker exec "$DB_CID" psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at))), 0)::int FROM enrollment_notificacion_outbox WHERE status = 'PENDIENTE'" 2>/dev/null || true)"
    OUTBOX_RECUP="$(docker exec "$DB_CID" psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at))), 0)::int FROM recuperacion_outbox WHERE status = 'PENDIENTE'" 2>/dev/null || true)"
    OUTBOX_VERIF="$(docker exec "$DB_CID" psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at))), 0)::int FROM verificacion_correo_outbox WHERE status = 'PENDIENTE'" 2>/dev/null || true)"
  fi

  # ── Muestra JSONL ──
  RUN_DIR="$RUN_DIR" \
    RESTARTS="$RESTARTS" OOM="$OOM" RUNNING="$RUNNING" \
    STATS_BACKEND="$STATS_BACKEND" STATS_DB="$STATS_DB" \
    CONN="$CONN" MAXCONN="$MAXCONN" \
    OUTBOX_ENROLL="$OUTBOX_ENROLL" OUTBOX_RECUP="$OUTBOX_RECUP" OUTBOX_VERIF="$OUTBOX_VERIF" \
    python3 - <<'PY' >>"$JSONL"
import datetime
import json
import os


def num_or_none(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def stat_or_none(stats):
    """'12.34%|123.4MiB / 7.7GiB' → {cpu_percent, mem_used_mb, mem_limit_mb}."""
    if not stats or "|" not in stats:
        return None
    cpu, mem = stats.split("|", 1)
    try:
        used, limit = [part.strip().split()[0] for part in mem.split("/")]
    except (ValueError, IndexError):
        return {"cpu_percent": cpu.strip().rstrip("%") or None, "mem_used_mb": None, "mem_limit_mb": None}

    def to_mb(text):
        unidades = {"KiB": 1 / 1024, "MiB": 1, "GiB": 1024}
        numero, unidad = text[:-3], text[-3:]
        try:
            return round(float(numero) * unidades.get(unidad, 1), 1)
        except ValueError:
            return None

    try:
        cpu_pct = float(cpu.strip().rstrip("%"))
    except ValueError:
        cpu_pct = None
    return {"cpu_percent": cpu_pct, "mem_used_mb": to_mb(used), "mem_limit_mb": to_mb(limit)}


print(json.dumps({
    "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "backend_container": {
        "restarts": num_or_none(os.environ.get("RESTARTS")),
        "oom_killed": os.environ.get("OOM", "").strip().lower() == "true" or None,
        "running": os.environ.get("RUNNING", "").strip().lower() == "true" or None,
        "stats": stat_or_none(os.environ.get("STATS_BACKEND")),
    },
    "db": {
        "connections": num_or_none(os.environ.get("CONN")),
        "max_connections": num_or_none(os.environ.get("MAXCONN")),
        "stats": stat_or_none(os.environ.get("STATS_DB")),
    },
    "outbox_oldest_pending_seconds": {
        "enrollment_notificacion": num_or_none(os.environ.get("OUTBOX_ENROLL")),
        "recuperacion": num_or_none(os.environ.get("OUTBOX_RECUP")),
        "verificacion_correo": num_or_none(os.environ.get("OUTBOX_VERIF")),
    },
}, separators=(",", ":")))
PY

  # ── Abortos de host (umbral provisorio del tracker) ──
  if [ -n "$RUNNING" ] && [ "$RUNNING" != "true" ]; then
    abortar "el contenedor backend no está corriendo (State.Running=false)"
    break
  fi
  if [ -n "$OOM" ] && [ "$OOM" = "true" ]; then
    abortar "el contenedor backend fue OOM-killed (State.OOMKilled=true)"
    break
  fi
  if [ -n "$RESTARTS" ]; then
    if [ -z "$restarts_base" ]; then
      restarts_base="$RESTARTS"
    elif [ "$RESTARTS" -gt "$restarts_base" ] 2>/dev/null; then
      abortar "el contenedor backend se reinició durante la corrida (RestartCount $restarts_base → $RESTARTS)"
      break
    fi
  fi

  if [ -n "$CONN" ] && [ -n "$MAXCONN" ] && [ "$MAXCONN" -gt 0 ] 2>/dev/null; then
    if [ "$((CONN * 100))" -ge "$((MAXCONN * POOL_LIMIT_PCT))" ] 2>/dev/null; then
      consec_pool=$((consec_pool + 1))
    else
      consec_pool=0
    fi
    if [ "$consec_pool" -ge "$POOL_CONSECUTIVO" ]; then
      abortar "agotamiento del pool de conexiones: $CONN/$MAXCONN conexiones (>= ${POOL_LIMIT_PCT}%) en $consec_pool muestras consecutivas"
      break
    fi
  fi

  peor_outbox="$(printf '%s\n%s\n%s\n' "$OUTBOX_ENROLL" "$OUTBOX_RECUP" "$OUTBOX_VERIF" | sort -n | tail -n1)"
  if [ -n "$peor_outbox" ] && [ "$peor_outbox" -gt "$OUTBOX_LIMITE" ] 2>/dev/null; then
    consec_outbox=$((consec_outbox + 1))
    if [ "$consec_outbox" -ge "$OUTBOX_CONSECUTIVO" ]; then
      abortar "outbox PENDIENTE más viejo en ${peor_outbox}s (>${OUTBOX_LIMITE}s) durante $consec_outbox muestras consecutivas: crece sin límite"
      break
    fi
  else
    consec_outbox=0
  fi

  sleep "$INTERVAL"
done

exit 0
