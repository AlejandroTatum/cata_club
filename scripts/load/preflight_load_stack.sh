#!/usr/bin/env bash
# Preflight for the local QA load runs (tracker T3).
#
# PASSIVE by design: it only checks health, it never starts or restarts
# anything, so it can never collide with a running db-test or another stack.
# Fail-closed: any missing piece exits 1 and names the fix.
#
#   1. Docker daemon reachable.
#   2. db-test healthy on localhost:5436 (the repo's backend-test Postgres;
#      the tracker pins the preflight to it). Load traffic itself targets the
#      QA stack, not db-test.
#   3. QA edge up: frontend :3000 (the public entry every journey hits) and
#      backend :8000 readiness (which checks DB connectivity).
#   4. Warns (does not fail) when the pinned k6 image is not pulled yet.
#
# Load runs target ONLY localhost. Staging and production are prohibited
# targets (docs/operations/load-testing.md).
set -euo pipefail

FALLOS=()

dice() { printf '  ✗ %s\n' "$1"; FALLOS+=("$1"); }

echo "Preflight de pruebas de carga (QA local)..."

# 1 ─ Docker daemon
if ! docker info >/dev/null 2>&1; then
  dice "el daemon de Docker no responde"
else
  echo "  ✓ daemon de Docker"

  # 2 ─ db-test en localhost:5436 (salud, sin levantar nada)
  if (exec 3<>/dev/tcp/127.0.0.1/5436) 2>/dev/null; then
    { exec 3>&- 3<&-; } 2>/dev/null || true
    DB_TEST_CID="$(docker ps -q --filter 'label=com.docker.compose.service=db-test' | head -n1)"
    if [ -n "$DB_TEST_CID" ] && docker exec "$DB_TEST_CID" pg_isready >/dev/null 2>&1; then
      echo "  ✓ db-test sano en localhost:5436"
    else
      dice "puerto 5436 abierto pero el contenedor db-test no responde a pg_isready"
    fi
  else
    dice "db-test no está publicado en localhost:5436 (levantalo con: make test-backend-preflight)"
  fi
fi

# 3 ─ Borde público de QA: frontend :3000 y backend :8000
if curl -fsS --max-time 5 http://localhost:3000/api/health >/dev/null 2>&1; then
  echo "  ✓ frontend de QA en http://localhost:3000/api/health"
else
  dice "frontend de QA no responde en http://localhost:3000/api/health (levantalo con: make qa-up)"
fi

if curl -fsS --max-time 5 http://localhost:8000/health/ready >/dev/null 2>&1; then
  echo "  ✓ backend de QA en http://localhost:8000/health/ready"
else
  dice "backend de QA no responde en http://localhost:8000/health/ready (¿subió con DB?)"
fi

# 4 ─ Imagen k6 fijada (aviso, no fallo: el primer run hace pull)
K6_IMAGE="${K6_IMAGE:-grafana/k6:1.0.0}"
if docker image inspect "$K6_IMAGE" >/dev/null 2>&1; then
  echo "  ✓ imagen $K6_IMAGE ya está local"
else
  echo "  · AVISO: la imagen $K6_IMAGE no está local; la primera corrida hace pull"
fi

if [ "${#FALLOS[@]}" -gt 0 ]; then
  printf '\nPreflight FALLIDO (%s):\n' "${#FALLOS[@]}" >&2
  for f in "${FALLOS[@]}"; do printf '  - %s\n' "$f" >&2; done
  exit 1
fi

echo "Preflight OK: stack local listo para pruebas de carga."
