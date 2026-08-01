.PHONY: help dev dev-backend dev-frontend test test-backend test-frontend test-compose \
       lint lint-backend lint-frontend typecheck build build-frontend \
       install install-backend install-frontend \
       docker-up docker-down docker-build \
       migrate migrate-create db-reset seed seed-bulk clean \
       qa-up qa-down qa-seed qa-reset qa-live qa-logs

# ─── Default ────────────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Development ────────────────────────────────────────────────────────────
dev: ## Start backend (Docker) + frontend (local) in parallel
	@echo "Starting backend via Docker Compose..."
	@docker compose up -d db redis backend celery-worker celery-beat
	@echo "Starting frontend locally..."
	@cd frontend && pnpm dev &
	@echo ""
	@echo "  Frontend: http://localhost:3000"
	@echo "  Backend:  http://localhost:8000/docs"
	@echo "  Stop:     make docker-down"

dev-backend: ## Start backend services only (Docker)
	docker compose up -d db redis backend celery-worker celery-beat

dev-frontend: ## Start frontend only (local)
	cd frontend && pnpm dev

# ─── Install ────────────────────────────────────────────────────────────────
install: install-backend install-frontend ## Install all dependencies

install-backend: ## Install backend dependencies (uv)
	cd backend && uv sync

install-frontend: ## Install frontend dependencies (pnpm)
	cd frontend && pnpm install

# ─── Testing ────────────────────────────────────────────────────────────────
# `test-compose` incluido a propósito: es el mismo gate que corre CI (paso
# "Compose config tests" del job `backend` en .github/workflows/ci.yml), así
# que una corrida local reproduce la señal de CI y no descubre el fallo
# recién en el PR. No necesita Postgres, solo Docker Compose.
test: test-backend test-compose test-frontend ## Run all tests

# Requiere `db-test` corriendo (`docker compose --profile test up -d
# db-test`, ver docker-compose.yml): la suite ya no tiene una rama SQLite de
# respaldo (sdd/production-readiness, decisión 1.5 -- sunset en PR-06f).
# El puerto 5436 es el publicado por `db-test` en docker-compose.yml;
# TEST_DATABASE_URL en el entorno invocador tiene prioridad sobre este default.
test-backend: ## Run backend tests (pytest, requires: docker compose --profile test up -d db-test)
	cd backend && TEST_DATABASE_URL="$${TEST_DATABASE_URL:-postgresql+psycopg://usuario:password@localhost:5436/cataclub_test}" uv run pytest tests/ -v

test-frontend: ## Run frontend unit tests (vitest)
	cd frontend && pnpm test

# No requiere Postgres ni TEST_DATABASE_URL: solo Docker Compose. Corre
# fuera de la suite de backend/tests a propósito (sdd/production-readiness,
# PR-14) -- reutiliza el pytest ya instalado en el venv del backend.
test-compose: ## Validate production compose layering (no build/ports leak into prod)
	cd backend && uv run pytest ../tests/test_docker_compose_config.py -v

# ─── Linting ────────────────────────────────────────────────────────────────
lint: lint-backend lint-frontend ## Lint both projects

lint-backend: ## Lint backend (ruff)
	cd backend && uv run ruff check .

lint-frontend: ## Lint frontend (next lint)
	cd frontend && pnpm lint

# ─── Type checking ──────────────────────────────────────────────────────────
typecheck: ## Type-check frontend (tsc)
	cd frontend && pnpm type-check

# ─── Build ──────────────────────────────────────────────────────────────────
build: build-frontend ## Build all projects

build-frontend: ## Build frontend for production
	cd frontend && pnpm build

# ─── Docker ─────────────────────────────────────────────────────────────────
docker-up: ## Start all services via Docker Compose
	docker compose up -d

docker-down: ## Stop all Docker Compose services
	docker compose down

docker-build: ## Build Docker images
	docker compose build

# ─── Database ───────────────────────────────────────────────────────────────
migrate: ## Run Alembic migrations
	cd backend && uv run alembic upgrade head

migrate-create: ## Create a new Alembic migration (usage: make migrate-create MSG="add foo")
	cd backend && uv run alembic revision --autogenerate -m "$(MSG)"

db-reset: ## DESTRUCTIVE (dev only): drop+recreate schema, migrate from empty, reseed. See backend/scripts/RUNBOOK_reset_db.md
	cd backend && uv run python scripts/reset_dev_db.py

# ─── Seed ───────────────────────────────────────────────────────────────────
# Both seeds run inside the backend container, where DATABASE_URL is injected
# by Compose. From the host shell there is no backend/.env, so Settings falls
# back to its localhost:5432 default while Compose publishes Postgres on 5433.
# The base seed also runs automatically on container start when
# AMBIENTE=development — this target is for re-running it on demand.
seed: ## Seed the base dev dataset (admin, trainer, students, schedules)
	docker compose exec backend uv run python scripts/seed_dev_base.py

seed-bulk: ## Seed the large dev dataset (requires `make seed` first)
	docker compose exec backend uv run python scripts/seed_dev_bulk.py

# ─── Entorno de QA ──────────────────────────────────────────────────────────
# Stack desechable y sembrado para E2E reales y QA manual (issue #33). Ver la
# sección "Entorno de QA" del README y `docker-compose.qa.yml`.
#
# No es un stack nuevo: ensambla los servicios de Compose que ya existen, los
# dos seeds que ya existen (`seed_dev_base.py` vía `scripts/entrypoint.sh`, y
# `seed_dev_bulk.py`) y `reset_dev_db.py` con su runbook.
#
# Usa los mismos puertos publicados que `make dev`, así que los dos son
# alternativas: pará el stack de desarrollo (`make docker-down`) antes de
# levantar el de QA.
QA_COMPOSE = docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.qa.yml

# Clave aleatoria por invocación de `make`, no un literal versionado: el
# entorno es desechable y su base se destruye en cada `qa-up`, así que no hay
# ninguna sesión que preservar entre corridas. `docker-compose.yml` declara
# `${JWT_SECRET_KEY:?...}` y esa interpolación ocurre antes de fusionar los
# overlays, así que ningún archivo de Compose puede aportarla -- tiene que
# entrar por el entorno. `:=` la evalúa UNA vez, para que todos los targets de
# una misma corrida compartan el mismo valor.
QA_JWT_SECRET_KEY := $(shell openssl rand -hex 32)
QA_ENV = JWT_SECRET_KEY=$(QA_JWT_SECRET_KEY)

# `celery-worker`/`celery-beat` quedan fuera a propósito: el QA de pantallas no
# necesita tareas programadas y cada worker cuesta memoria.
QA_SERVICIOS = db redis mailpit backend frontend

# `--build` y no solo `up`: el objetivo del entorno es mirar el código ACTUAL.
# Sin esto, Compose reutiliza la imagen que ya exista y se puede terminar
# evaluando una UI vieja sin que nada lo diga.
# `--wait` bloquea hasta que los healthchecks pasan, así que cuando el target
# vuelve el stack ya responde: `scripts/entrypoint.sh` corrió
# `alembic upgrade head` y `seed_dev_base.py` (AMBIENTE=development).
qa-up: ## Levantar el entorno de QA desde cero: build + base sembrada + frontend
	@echo "Levantando entorno de QA (proyecto cataclub-qa)..."
	$(QA_ENV) $(QA_COMPOSE) up -d --build --wait $(QA_SERVICIOS)
	@echo "Sembrando el dataset grande (seed_dev_bulk.py)..."
	$(QA_ENV) $(QA_COMPOSE) exec -T backend uv run python scripts/seed_dev_bulk.py
	@echo ""
	@echo "  Frontend:  http://localhost:3000"
	@echo "  Backend:   http://localhost:8000/docs"
	@echo "  Correos:   http://localhost:8025"
	@echo "  Admin:     admin@cataclub.com / admin12345"
	@echo "  Entrenador: entrenador@cataclub.com / trainer12345"
	@echo "  Alumnos del dataset grande: contrasenia alumno123"
	@echo "  Destruir:  make qa-down"

qa-down: ## Destruir por completo el entorno de QA (contenedores, red y datos)
	$(QA_ENV) $(QA_COMPOSE) down -v --remove-orphans

qa-seed: ## Re-sembrar el dataset grande sobre el entorno de QA ya levantado
	$(QA_ENV) $(QA_COMPOSE) exec -T backend uv run python scripts/seed_dev_bulk.py

# Reutiliza `reset_dev_db.py` (ver backend/scripts/RUNBOOK_reset_db.md): DROP
# SCHEMA + `alembic upgrade head` desde vacío + `seed_dev_base.py`. Su
# allow-list de hosts acepta `db`, que es el hostname del Postgres de QA, y
# `AMBIENTE=development` evita tener que pasar `--forzado`.
qa-reset: ## Volver el entorno de QA a su estado recien sembrado (sin rebuild)
	$(QA_ENV) $(QA_COMPOSE) exec -T backend uv run python scripts/reset_dev_db.py
	$(MAKE) qa-seed

# `PLAYWRIGHT_BASE_URL` apunta al frontend del stack de QA, lo que además
# desactiva el `webServer` gestionado (ver tests/e2e/e2e-target.ts): la suite
# prueba la imagen que `make qa-up` construyó, no una segunda compilación
# paralela. `E2E_LIVE=1` habilita el proyecto de Playwright que recoge los
# `*.live.spec.ts`.
# El target NO se llama `qa-e2e` porque el `make help` de este archivo filtra
# con `^[a-zA-Z_-]+:` y un target con dígitos queda invisible en la ayuda.
qa-live: ## Correr los specs E2E que atraviesan el backend real de QA
	cd frontend && E2E_LIVE=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 \
		pnpm exec playwright test --project=e2e-live

qa-logs: ## Ver los logs del entorno de QA
	$(QA_ENV) $(QA_COMPOSE) logs -f

# ─── Clean ──────────────────────────────────────────────────────────────────
clean: clean-backend clean-frontend ## Clean caches from both projects

clean-backend: ## Clean Python caches
	cd backend && find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	cd backend && rm -rf .pytest_cache .coverage htmlcov

clean-frontend: ## Clean Next.js build cache
	cd frontend && rm -rf .next .turbo node_modules/.cache

# ─── Logs ───────────────────────────────────────────────────────────────────
logs: ## Show Docker Compose logs
	docker compose logs -f

logs-backend: ## Show backend logs only
	docker compose logs -f backend
