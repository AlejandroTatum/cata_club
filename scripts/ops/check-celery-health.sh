#!/usr/bin/env bash
# Reports whether celery-worker and celery-beat are healthy right now, so the
# daily backup heartbeat (docs/operations/monitoring.md) also alerts when
# Celery gets stuck BETWEEN deployments (issue #1061).
#
# `docker-compose.yml` already declares a proper healthcheck for each service
# (`inspect ping -d` for the worker, freshness of `celerybeat-schedule` for
# beat, refreshed every 30s), and `check_celery`
# (scripts/deploy/lib/post-checks.sh) already reads that same signal at
# deploy/rollback time (issue #791/#1064). This script is only a new CALLER
# for that existing signal: no new liveness probe, no new alert provider.
# `/health/ready` (backend/main.py) is deliberately left out of this signal:
# it is the compose readiness probe that decides whether `autoheal`-adjacent
# orchestration restarts the API, and the API can serve requests without a
# healthy beat -- coupling the two would make a Celery problem restart the
# backend for no reason.
#
# Read-only and provider-neutral, same contract as check-backup-freshness.sh:
# this script only decides whether Celery is healthy; the caller (the cron,
# chained with `&&` before notify-heartbeat.sh) decides how to alert.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

STACK_DIR="${STACK_DIR:-/opt/cata-club}"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

# shellcheck source=../deploy/lib/post-checks.sh
source "$SCRIPT_DIR/../deploy/lib/post-checks.sh"

cd "$STACK_DIR"
check_celery
log "celery-worker y celery-beat: saludables"
