#!/bin/sh
# Entrypoint del contenedor `backend` (invocado desde docker-compose.yml).
#
# Root cause del incidente que motivó este script (ver
# backend/scripts/RUNBOOK_reset_db.md): el `command` anterior encadenaba
# `uv run alembic upgrade head;` con `;`, no `&&`. En `sh`, `;` NO propaga el
# código de salida del comando anterior — así que si la migración fallaba,
# el contenedor arrancaba igual sobre un esquema desactualizado o
# inconsistente, sirviendo tráfico en silencio.
#
# `set -eu` corrige esto: cualquier comando que falle (variable no definida,
# o exit status != 0) aborta el script ANTES de llegar a `uvicorn`. No se usa
# `pipefail` porque no es POSIX sh (este script corre con `sh`, no `bash`).
set -eu

# `--frozen --no-build` en cada `uv run`: no resuelve versiones fuera del lock
# y no ejecuta setup scripts de sdists (los 72 paquetes del lock resuelven a
# wheels). Verificado dentro del contenedor antes de adoptarlo, porque este
# script es el arranque: si los flags fallaran, el contenedor no levanta.
uv run --frozen --no-build alembic upgrade head

# `set -e` no aborta por una condición `if` falsa (exit 0 normal); pero SÍ
# aborta si el seed dentro del cuerpo del `if` falla — el semantics
# condicional se preserva exactamente igual que en el `command` inline
# original.
if [ "${AMBIENTE:-production}" = "development" ]; then
  uv run --frozen --no-build python scripts/seed_dev_base.py
fi

# `exec` reemplaza este proceso `sh` por uvicorn en vez de encadenarlo como
# hijo: uvicorn pasa a ser PID 1 dentro del contenedor, así que
# `docker stop` (SIGTERM) llega directo a él y el shutdown es limpio, en vez
# de perderse porque `sh` no lo reenvía a sus hijos.
exec uv run --frozen --no-build uvicorn main:app --host 0.0.0.0 --port 8000
