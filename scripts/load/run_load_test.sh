#!/usr/bin/env bash
# Run one k6 load scenario against the LOCAL QA stack (tracker T3/T4).
#
#   Usage: run_load_test.sh <baseline|ramp|steady_100>
#
# - Uses the OFFICIAL PINNED k6 Docker image (no host k6 install needed).
# - Fail-closed localhost guard (layer 2 of 3; k6's common.js is layer 3):
#   staging and production are PROHIBITED targets for this harness.
# - Credentials arrive via environment only: LOAD_CREDENTIALS_JSON (a bounded
#   pool, reused across VUs — 100 VUs do not mean 100 identities) or
#   LOAD_EMAIL + LOAD_PASSWORD. Never committed, never defaulted.
# - Per-run evidence lands in load/results/<UTC ts>-<scenario>/ (git-ignored):
#     summary.json     machine-readable k6 summary (+ VU-vs-sessions block)
#     resources.jsonl  host/container resource samples (monitor_resources.sh)
#     metrics-before.prom / metrics-after.prom  backend /metrics scrapes (best-effort)
#     server-metrics.json  per-route server-side deltas (scripts/load/server_metrics.py)
#     run.json         run metadata (scenario, image, exit code, artifacts)
#     abort.txt        present only when the host monitor aborted the run
#     k6-stdout.log    k6's human stdout (k6 text summary at the end)
#     k6-raw.json      optional per-request stream when LOAD_K6_JSON=1
set -euo pipefail

K6_IMAGE="${K6_IMAGE:-grafana/k6:1.0.0}" # official image, pinned; never a moving tag
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ESCENARIO="${1:-}"

case "$ESCENARIO" in
  baseline | ramp | steady_100) ;;
  *)
    echo "Uso: $0 <baseline|ramp|steady_100>" >&2
    exit 64
    ;;
esac

# Steady VU count (default 100): entero positivo, validado antes de tocar nada.
if [[ ! "${LOAD_STEADY_VUS:-100}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: LOAD_STEADY_VUS debe ser un entero positivo; obtuve '${LOAD_STEADY_VUS}'." >&2
  exit 64
fi

# ── Fail-closed host guard: solo loopback, jamás userinfo ───────────────
# Solo http://localhost[:puerto], http://127.x.x.x[:puerto] y
# http://[::1]:[puerto]. Una autoridad con userinfo — p. ej.
# 'http://127.0.0.1:9@staging.example.com' — apunta REALMENTE a
# staging.example.com: se rechaza SIEMPRE, antes de partir puerto/host.
rechazar_host() {
  echo "PROHIBIDO: LOAD_BASE_URL debe apuntar al stack local" >&2
  echo "(http://localhost:3000, http://127.0.0.1:[puerto], http://[::1]:[puerto])." >&2
  echo "Motivo: $1. Staging y producción son blancos prohibidos para este" >&2
  echo "harness (docs/operations/load-testing.md)." >&2
  exit 1
}

LOAD_BASE_URL="${LOAD_BASE_URL:-http://localhost:3000}"

case "$LOAD_BASE_URL" in
  http://*) ;;
  *) rechazar_host "solo se acepta http://; obtuve '$LOAD_BASE_URL'" ;;
esac

AUTH="${LOAD_BASE_URL#http://}"
AUTH="${AUTH%%/*}"

# Userinfo primero: cualquier '@' en la autoridad es rechazo inmediato.
case "$AUTH" in
  *@*) rechazar_host "la autoridad lleva userinfo ('@'); obtuve '$LOAD_BASE_URL'" ;;
esac

# Host sin puerto, consciente de corchetes IPv6.
case "$AUTH" in
  \[*\]:*) HOST="${AUTH%:*}" ;;
  \[*\]) HOST="$AUTH" ;;
  *:*) HOST="${AUTH%%:*}" ;;
  *) HOST="$AUTH" ;;
esac

case "$HOST" in
  localhost | \[::1\]) ;;
  127.*)
    if ! [[ "$HOST" =~ ^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
      rechazar_host "'$HOST' no es una dirección 127.0.0.0/8 válida"
    fi
    ;;
  *)
    rechazar_host "'$HOST' no es loopback"
    ;;
esac

# ── Credenciales solo por entorno/archivo local, nunca con default ─────────
# Tres fuentes válidas: LOAD_CREDENTIALS_FILE (archivo git-ignorado generado
# por scripts/load/build_credentials_pool.py — preferido para pools de 100),
# LOAD_CREDENTIALS_JSON, o LOAD_EMAIL + LOAD_PASSWORD.
if [ -n "${LOAD_CREDENTIALS_FILE:-}" ]; then
  # -v exige ruta absoluta del host: las relativas se resuelven al repo.
  if [[ "$LOAD_CREDENTIALS_FILE" != /* ]]; then
    LOAD_CREDENTIALS_FILE="$REPO_ROOT/$LOAD_CREDENTIALS_FILE"
  fi
  if [ ! -f "$LOAD_CREDENTIALS_FILE" ]; then
    echo "Error: LOAD_CREDENTIALS_FILE apunta a un archivo inexistente: $LOAD_CREDENTIALS_FILE" >&2
    exit 1
  fi
fi
if [ -z "${LOAD_CREDENTIALS_FILE:-}" ] && [ -z "${LOAD_CREDENTIALS_JSON:-}" ] && { [ -z "${LOAD_EMAIL:-}" ] || [ -z "${LOAD_PASSWORD:-}" ]; }; then
  echo "Error: faltan credenciales. Usa LOAD_CREDENTIALS_FILE (make load-pool)," >&2
  echo "LOAD_CREDENTIALS_JSON, o LOAD_EMAIL y LOAD_PASSWORD, y vuelve a invocar." >&2
  exit 1
fi

# ── El borde local de QA debe estar sano antes de tirarle tráfico ───────────
if ! curl -fsS --max-time 5 http://localhost:3000/api/health >/dev/null 2>&1; then
  echo "Error: el frontend de QA no responde en http://localhost:3000/api/health." >&2
  echo "Levantá el stack con 'make qa-up' (y corré 'make load-preflight') antes de cargar." >&2
  exit 1
fi

# ── Directorio de evidencia por corrida (git-ignorado) ──────────────────────
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$ESCENARIO"
RUN_DIR="$REPO_ROOT/load/results/$RUN_ID"
mkdir -p "$RUN_DIR"
echo "Evidencia de la corrida: $RUN_DIR"

# ── Limpieza garantizada (salidas anormales incluidas) ──────────────────
# Solo toca archivos de evidencia y manda señales: seguro ante INT/TERM.
# El trap EXIT corre también en la salida normal: es idempotente.
limpiar() {
  touch "$RUN_DIR/stop" 2>/dev/null || true
  if [ -n "${MONITOR_PID:-}" ]; then
    kill "$MONITOR_PID" 2>/dev/null || true
  fi
}
trap limpiar EXIT
trap 'limpiar; exit 130' INT
trap 'limpiar; exit 143' TERM

INICIO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Monitor de recursos + abortos de host (tracker T4) ──────────────────────
# El monitor vigila contenedor/BD/outbox y, si cruza un umbral de aborto,
# escribe abort.txt y corta k6 con SIGTERM. Sin monitor (p. ej. borrado
# accidental) la corrida sigue con un aviso: se pierde la evidencia de
# recursos y los abortos de host, pero k6 sigue aplicando SUS abortos.
MONITOR_PID=""
if [ -x "$REPO_ROOT/scripts/load/monitor_resources.sh" ]; then
  "$REPO_ROOT/scripts/load/monitor_resources.sh" "$RUN_DIR" &
  MONITOR_PID=$!
else
  echo "AVISO: monitor_resources.sh no está disponible; esta corrida no tendrá evidencia de recursos ni abortos de host." >&2
fi

# ── Scrape de /metrics del backend (server-side), best-effort ──────────────
# /metrics NO es público: se lee desde DENTRO del contenedor backend (mismo
# descubrimiento por labels de Compose que el monitor; -a incluye detenidos).
# El QA publica 127.0.0.1:8000, pero el scrape por exec no depende de eso. Si
# falla (sin docker, contenedor caído), la corrida sigue sin cifras server-side.
BACKEND_CID="$(docker ps -q \
  --filter "label=com.docker.compose.project=cataclub-qa" \
  --filter "label=com.docker.compose.service=backend" 2>/dev/null | head -n1 || true)"

scrapear_metricas() {
  [ -n "$BACKEND_CID" ] || return 1
  docker exec "$BACKEND_CID" python -c \
    "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/metrics',timeout=10).read().decode())" \
    >"$1" 2>/dev/null
}

scrapear_metricas "$RUN_DIR/metrics-before.prom" || echo "AVISO: no se pudo scrapear /metrics antes de la corrida; sin cifras server-side." >&2

# ── Lanzar k6 dentro de la imagen oficial fijada ────────────────────────────
# --network host: en Linux el contenedor alcanza localhost:3000 del host.
# --user: los artefactos quedan del operador, no de root.
docker image inspect "$K6_IMAGE" >/dev/null 2>&1 || docker pull "$K6_IMAGE" >/dev/null

# Argumentos de k6 en array: la expansión opcional de --out sin comillas
# partía palabras (y habilitaba globbing) cuando LOAD_K6_JSON está vacío.
K6_ARGS=(run "/scripts/$ESCENARIO.js")
if [ -n "${LOAD_K6_JSON:-}" ]; then
  K6_ARGS+=(--out "json=/results/k6-raw.json")
fi

K6_DOCKER_ARGS=(
  --network host --user "$(id -u):$(id -g)"
  -v "$REPO_ROOT/load/k6":/scripts:ro
  -v "$RUN_DIR":/results -w /results
  -e LOAD_BASE_URL
  -e LOAD_CREDENTIALS_JSON
  -e LOAD_EMAIL
  -e LOAD_PASSWORD
  -e LOAD_STEADY_DURATION
  -e LOAD_STEADY_VUS
  -e LOAD_BASELINE_DURATION
  -e LOAD_RAMP_MAX_VUS
  -e LOAD_RESULTS_DIR=/results
)
if [ -n "${LOAD_CREDENTIALS_FILE:-}" ]; then
  K6_DOCKER_ARGS+=(-v "$LOAD_CREDENTIALS_FILE":/creds/pool.json:ro -e LOAD_CREDENTIALS_FILE=/creds/pool.json)
fi

set +e
docker run --rm "${K6_DOCKER_ARGS[@]}" \
  "$K6_IMAGE" "${K6_ARGS[@]}" \
  >"$RUN_DIR/k6-stdout.log" 2>&1 &
K6_PID=$!
echo "$K6_PID" >"$RUN_DIR/k6.pid"

wait "$K6_PID"
CODIGO_K6=$?
set -e

# ── Cerrar el monitor ────────────────────────────────────────────────────────
touch "$RUN_DIR/stop"
if [ -n "$MONITOR_PID" ]; then
  wait "$MONITOR_PID" || true
fi

FIN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Scrape posterior + deltas server-side ────────────────────────────────────
SERVER_METRICS_OK=0
if scrapear_metricas "$RUN_DIR/metrics-after.prom" && [ -s "$RUN_DIR/metrics-before.prom" ]; then
  if python3 "$REPO_ROOT/scripts/load/server_metrics.py" \
    "$RUN_DIR/metrics-before.prom" "$RUN_DIR/metrics-after.prom" \
    --json "$RUN_DIR/server-metrics.json" >"$RUN_DIR/server-metrics.txt"; then
    SERVER_METRICS_OK=1
    cat "$RUN_DIR/server-metrics.txt"
  fi
fi
[ "$SERVER_METRICS_OK" = 1 ] || echo "AVISO: sin cifras server-side en esta corrida (scrape antes/después incompleto)." >&2

# ── run.json: metadatos legibles por máquina de la corrida ──────────────────
RUN_DIR="$RUN_DIR" ESCENARIO="$ESCENARIO" K6_IMAGE="$K6_IMAGE" CODIGO_K6="$CODIGO_K6" \
  INICIO="$INICIO" FIN="$FIN" LOAD_BASE_URL="$LOAD_BASE_URL" \
  LOAD_STEADY_VUS="${LOAD_STEADY_VUS:-100}" python3 - <<'PY' >"$RUN_DIR/run.json"
import json
import os

run_dir = os.environ["RUN_DIR"]

def existe(nombre):
    return os.path.isfile(os.path.join(run_dir, nombre))

server_metrics = None
if existe("server-metrics.json"):
    with open(os.path.join(run_dir, "server-metrics.json"), encoding="utf-8") as f:
        server_metrics = json.load(f)

interpretacion = {
    0: "thresholds cumplidos",
    99: "umbral k6 incumplido (aceptación o aborto abortOnFail)",
    105: "k6 interrumpido (aborto del monitor de host, o Ctrl-C del operador)",
}.get(int(os.environ["CODIGO_K6"]), "ver k6-stdout.log")

print(json.dumps({
    "scenario": os.environ["ESCENARIO"],
    "base_url": os.environ["LOAD_BASE_URL"],
    "k6_image": os.environ["K6_IMAGE"],
    "started_at": os.environ["INICIO"],
    "finished_at": os.environ["FIN"],
    "steady_vus": int(os.environ["LOAD_STEADY_VUS"]) if os.environ["ESCENARIO"] == "steady_100" else None,
    "server_metrics": server_metrics,
    "k6_exit_code": int(os.environ["CODIGO_K6"]),
    "k6_exit_meaning": interpretacion,
    "monitor_aborted": existe("abort.txt"),
    "artifacts": [n for n in (
        "summary.json", "resources.jsonl", "abort.txt", "metrics-before.prom",
        "metrics-after.prom", "server-metrics.json", "k6-stdout.log", "k6-raw.json",
    ) if existe(n)],
    "credentials_source": "env-only (LOAD_CREDENTIALS_JSON pool or LOAD_EMAIL/LOAD_PASSWORD)",
}, indent=2))
PY

echo "Corrida terminada (k6 exit $CODIGO_K6). Evidencia en: $RUN_DIR"
cat "$RUN_DIR/run.json"

# Reflejar el resultado de k6: un umbral de aceptación incumplido debe romper
# el make target, no pasar desapercibido.
exit "$CODIGO_K6"
