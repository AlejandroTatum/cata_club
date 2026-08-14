# Design: Production Readiness Cleanup (P0/P1 Hygiene)

## Technical Approach

Config/docs/tooling only — zero application-behavior change. Six deterministic,
independently-verifiable edits delivered in one PR ordered so the lockfile is
regenerated last (after every `pyproject.toml` edit) and validated against the
exact `--frozen` commands CI and Docker already run. Each item is proven by a
passing install, build, or coverage report — no new specs, no runtime logic.

## Architecture Decisions

### Decision: Lockfile fix via regeneration, not stash

**Choice**: Edit `pyproject.toml` first (add `openai` is already declared; add
`pytest-cov`; migrate groups), then run `uv lock` on current `main` to
regenerate `backend/uv.lock`. Validate with `uv lock --check` then
`uv sync --frozen`.
**Alternatives considered**: `git stash pop stash@{0}` (the pre-existing fix).
**Rationale**: The stash predates later dependency resolution and the
`pyproject` edits in this same change; popping it risks a lock that no longer
matches the final manifest and re-fails `--check`. Regeneration is
reproducible and idempotent (see Rollback in proposal). Lock MUST be the last
edit so it reflects the final `[dependency-groups]` + `pytest-cov` state.

### Decision: uv `[dependency-groups]` — no invocation changes

**Choice**: Replace `[tool.uv] dev-dependencies = [...]` with
`[dependency-groups]\ndev = [...]` and add `pytest-cov` to that `dev` group.
**Alternatives considered**: keep `[tool.uv]`; add `--group dev` to CI/Docker.
**Rationale**: `uv sync` installs the `dev` group **by default**, matching the
prior `dev-dependencies` behavior exactly. Therefore `.github/workflows/ci.yml`
and `backend/Dockerfile` (`uv sync --frozen`) need **no** flag change; parity
is preserved. Excluding dev deps from the prod image (`--no-dev`) is a behavior
change and stays out of scope.

### Decision: Coverage reported, never gated

**Choice**: Backend — CI test step becomes
`uv run pytest tests/ -v --cov=app --cov-report=term-missing` (no
`--cov-fail-under`). Frontend — add `@vitest/coverage-v8` devDependency and a
`"test:coverage": "vitest run --coverage"` script; CI runs it as a reported
step. Both totals surface in CI job logs (term report).
**Alternatives considered**: `pytest-cov` with a threshold; `istanbul` provider;
uploading HTML/artifact.
**Rationale**: `v8` matches the installed Vitest 2.x with no extra native
build; term output needs no artifact plumbing. Gating on an unmeasured baseline
would flip CI red (proposal risk), so coverage is informational this pass.

### Decision: Reconcile existing `.env.example` files, don't create new ones

**Choice**: `backend/.env.example` and `frontend/.env.local.example` are both
already present and git-tracked (`backend/.env.example` since commit
`87b6bfe`). Reconcile/expand each **in place**, preserving its curated
structure and comments, instead of overwriting or creating a parallel file.
**Root cause of the earlier "Create" premise**: the initial exploration used a
`Glob` pattern that does not match dotfiles, so both existing files were
missed. Apply must not trust that stale premise.
**Alternatives considered**: skip frontend file (proposal's conditional);
blind `Create`/overwrite of `backend/.env.example`; a new parallel
`frontend/.env.example`.
**Rationale**: Blind overwrite of `backend/.env.example` would clobber
comments already curated in the tracked file. A parallel
`frontend/.env.example` would leave three contradictory statements about
`NEXT_PUBLIC_API_URL` (existing `.env.local.example`, the new file, and
`frontend/src/app/README.md:16`), even though
`rg 'process\.env\.NEXT_PUBLIC_API_URL' frontend/src` returns zero matches —
the variable is dead in application code and lives on only as a `Dockerfile`
build ARG (`frontend/Dockerfile:15`).

Backend — `backend/.env.example` already covers `DATABASE_URL`, `JWT_*`,
`CORS_ORIGENES`, `REDIS_URL`, `CLOUDINARY_*`, `SEED_VOUCHER_BASE_URL`,
`CELERY_HORA_AUTOMATIZACIONES`. **Do not touch those entries or the file's
existing comments.** Append the fields missing versus `Settings`
(`backend/app/soporte_transversal/configuracion.py`), matching the file's
existing convention: `AMBIENTE`, `APP_NOMBRE`, `APP_VERSION` (optional, app
defaults — add commented), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS`, `FRONTEND_URL`,
`OPENCODE_API_KEY`, `CLOUDINARY_CARPETA_FOTOS_PERFIL`,
`CELERY_RESULT_EXPIRA_SEGUNDOS`. Convention: real secrets → placeholder
tokens the JWT validator rejects (e.g. `CAMBIAR-POR-...`); URLs → localhost
dev defaults, mirroring the existing style.

Frontend — `frontend/.env.local.example` already documents `BACKEND_API_URL`
(server-only, throws if unset), `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_NAME`
(`layout.tsx`), `NEXT_PUBLIC_USE_MOCKS` (`api.ts`). Its `NEXT_PUBLIC_API_URL`
entry is currently inaccurate — described as a live production var. Correct
its comment to state it is a `Dockerfile` build ARG only, not read anywhere
under `frontend/src`. Also correct the one contradicting sentence at
`frontend/src/app/README.md:16` (which claims `api.ts` reads
`NEXT_PUBLIC_API_URL` at runtime) so it matches the same "build-arg only"
fact — the result must leave exactly one consistent story about
`NEXT_PUBLIC_API_URL` across `.env.local.example`, the README, and the
Dockerfile. `NODE_ENV` excluded (framework-managed).

### Decision: README rewrite in place, structure preserved

**Choice**: Keep every section; correct only stale facts.
**Rationale**: Structure is sound; only PR #113 residue is wrong.

| Section | Action |
|---|---|
| Estructura → routers list | Drop `clases_extra` from the routers line |
| Modelo de Dominio | Drop `SolicitudClaseExtra (nueva)`; recompute entity count (was "19") from current `dominio/modelos.py` |
| Reglas de negocio table | Remove the `SolicitudClaseExtra` / `ClaseExtraServicio` row |
| Endpoints (33) | Drop the 3 `clases-extra` endpoints; recompute the count from current routers |
| Pruebas ("39") | Replace count + description via `uv run pytest --collect-only -q`; drop the "clases extra" test-coverage sentence |

Exact numbers are resolved by command at apply time, not guessed here.

### Decision: `docs/ux/` committed verbatim

**Choice**: `git add docs/ux/` (3 files: `evaluacion-usabilidad-rediseno.md`,
`plan-implementacion-rediseno.md`, `prototipo-rediseno.html`); no content edits.
**Rationale**: Approved source of truth for a future change; not in `.gitignore`.

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/pyproject.toml` | Modify | `[tool.uv]`→`[dependency-groups] dev`; add `pytest-cov` |
| `backend/uv.lock` | Modify | Regenerated last via `uv lock` (includes `openai`) |
| `backend/README.md` | Modify | Remove PR #113 residue; fix counts |
| `backend/.env.example` | Modify | Reconcile existing tracked file: append missing `Settings` keys (placeholders only); preserve existing entries/comments |
| `frontend/.env.local.example` | Modify | Correct `NEXT_PUBLIC_API_URL` comment to build-arg-only (not read at runtime by `src/`) |
| `frontend/src/app/README.md` | Modify | Fix line 16 claim that `api.ts` reads `NEXT_PUBLIC_API_URL` at runtime |
| `frontend/package.json` | Modify | `@vitest/coverage-v8` + `test:coverage` |
| `.github/workflows/ci.yml` | Modify | `--cov` on backend; frontend coverage step |
| `docs/ux/*` | Create (track) | Commit as-is |
| `backend/.gitattributes` | Create (optional) | `uv.lock linguist-generated=true` to collapse lock diff |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Install | `--frozen` reproducibility | `uv lock --check` + `uv sync --frozen` local/CI/Docker green |
| Suite | No regression | existing `pytest` + Vitest/Playwright stay green |
| Coverage | Totals appear | term reports in both CI jobs; no threshold |

## Migration / Rollout

No data migration. Single revertable PR; `uv lock` regenerable anytime.

## Sequencing, Branch, Commits

Branch: `chore/production-readiness-cleanup`. Order = manifest edits → lock →
docs → ux, so the lock reflects final `pyproject`:

1. `chore(backend): migrate to [dependency-groups] and add pytest-cov`
2. `fix(backend): resync uv.lock with openai dependency` (`uv lock`)
3. `test(ci): report backend and frontend coverage`
4. `docs(backend): rewrite README to current domain, reconcile .env.example`
5. `docs(frontend): reconcile .env.local.example and README env var docs`
6. `docs(ux): commit approved redesign source docs`

**400-line budget**: hand-authored diff stays well under budget. `uv.lock` is a
generated artifact — conventionally excluded from the review count. Present it
by (a) noting in the PR body "uv.lock is machine-generated; review
`pyproject.toml`, not the lock diff," and (b) optionally adding the
`.gitattributes` `linguist-generated` entry so GitHub collapses the lock diff.
`Decision needed before apply: No`. `Chained PRs recommended: No`.
`400-line budget risk: Low`.

## Open Questions

- [ ] None blocking. Exact entity/endpoint/test counts are resolved by command
      during apply (not a design decision).
