.PHONY: help dev dev-backend dev-frontend test test-backend test-frontend \
       lint lint-backend lint-frontend typecheck build build-frontend \
       install install-backend install-frontend \
       docker-up docker-down docker-build \
       migrate migrate-create db-reset seed seed-bulk clean

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
test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend tests (pytest)
	cd backend && uv run pytest tests/ -v

test-frontend: ## Run frontend unit tests (vitest)
	cd frontend && pnpm test

# ─── Linting ────────────────────────────────────────────────────────────────
lint: lint-backend lint-frontend ## Lint both projects

lint-backend: ## Lint backend (ruff)
	cd backend && uv run ruff check . || true

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
