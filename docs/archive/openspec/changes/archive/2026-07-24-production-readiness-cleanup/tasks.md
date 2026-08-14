# Tasks: Production Readiness Cleanup (P0/P1 Hygiene)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~150-180 reviewable (pyproject, CI yaml, package.json, README, .env.example x2, frontend README fix) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

Note: `uv.lock` diff is generated/excluded (see 1.3). `docs/ux/` (3 pre-approved
files, incl. a 293KB HTML prototype) is a pure tracked addition, not authored
in this change — flag both as non-line-reviewed in the PR body.

### Suggested Work Units
Single PR on `chore/production-readiness-cleanup` off `main`. No split needed.

## Phase 1: Backend Dependency Foundation

- [x] 1.1 Edit `backend/pyproject.toml`: replace `[tool.uv] dev-dependencies` with `[dependency-groups]\ndev = [...]`; add `pytest-cov` to `dev`.
  Verify: `rg 'dev-dependencies' backend/pyproject.toml` → no matches.
- [x] 1.2 Regenerate `backend/uv.lock`: `cd backend && uv lock` (after 1.1, before any other backend edit).
  Verify: `uv lock --check` exits 0.
- [x] 1.3 Diff-review the regenerated `uv.lock` before commit (only additive deps expected: openai, pytest-cov, coverage, distro, jiter, sniffio, tqdm — no version shifts).
  Verify: `git diff backend/uv.lock` reviewed manually; note in PR body.
- [x] 1.4 Confirm frozen install: `cd backend && uv sync --frozen`.
  Verify: exits 0, no re-resolution.

## Phase 2: Coverage Reporting

- [x] 2.1 Update `.github/workflows/ci.yml` backend test step to `uv run pytest tests/ -v --cov=app --cov-report=term-missing` (no `--cov-fail-under`).
  Verify: `--cov=app` present, no fail-under flag.
- [x] 2.2 Add `@vitest/coverage-v8@^2.1.9` (pinned to installed Vitest 2.1.9) as a devDependency in `frontend/package.json`; add `"test:coverage": "vitest run --coverage"` script.
  Verify: `pnpm add -D @vitest/coverage-v8@^2.1.9 && pnpm run test:coverage` produces a term report.
- [x] 2.3 Add a frontend coverage step to `.github/workflows/ci.yml` (reported only, no threshold).
  Verify: CI runs `pnpm run test:coverage`; job pass/fail unaffected by percentage.

## Phase 3: Backend Documentation Reconciliation

- [x] 3.1 Enumerate the actual domain: list ORM entities in `backend/app/*/dominio/modelos.py`, router files under `backend/app/presentacion/routers/`, and run `cd backend && uv run pytest --collect-only -q` for the real test count.
  Verify: outputs captured for use in 3.2. (21 entities, 10 routers, 218 tests collected)
- [x] 3.2 Rewrite `backend/README.md` (structure preserved) using the 3.1 enumeration — not just PR #113 residue: drop `clases_extra`/`SolicitudClaseExtra`/`ClaseExtraServicio`; recompute entity/router/endpoint counts and test count from actual code.
  Verify: `rg 'clases_extra|SolicitudClaseExtra|ClaseExtraServicio' backend/README.md` → zero matches; stated test count matches `pytest --collect-only -q` output.
- [x] 3.3 Reconcile `backend/.env.example` in place: append missing `Settings` keys (`AMBIENTE`, `APP_NOMBRE`, `APP_VERSION`, `SMTP_*`, `FRONTEND_URL`, `OPENCODE_API_KEY`, `CLOUDINARY_CARPETA_FOTOS_PERFIL`, `CELERY_RESULT_EXPIRA_SEGUNDOS`) with placeholders; preserve existing entries/comments.
  Verify: cross-check every `Settings` field in `configuracion.py` against the file; confirm no real secrets.

## Phase 4: Frontend Environment & Docs Reconciliation

- [x] 4.1 Correct `frontend/.env.local.example`'s `NEXT_PUBLIC_API_URL` comment to state it is a `Dockerfile` build ARG only, not read under `frontend/src`.
  Verify: `rg 'process\.env\.NEXT_PUBLIC_API_URL' frontend/src` → zero matches.
- [x] 4.2 Fix `frontend/src/app/README.md:16` claim that `api.ts` reads `NEXT_PUBLIC_API_URL` at runtime; align wording with 4.1.
  Verify: both files tell one consistent "build-arg only" story.

## Phase 5: UX Docs & Final Verification

- [x] 5.1 Track `docs/ux/` (3 files: `evaluacion-usabilidad-rediseno.md`, `plan-implementacion-rediseno.md`, `prototipo-rediseno.html`) via `git add docs/ux/`, no content edits.
  Verify: `git ls-files docs/ux/` lists all 3; `git status` shows none untracked.
- [x] 5.2 (Optional) Add `backend/.gitattributes` with `uv.lock linguist-generated=true` to collapse the lock diff on GitHub.
  Verify: `git check-attr linguist-generated backend/uv.lock` → `set`.
- [x] 5.3 Full verification sweep: `uv lock --check`, `uv sync --frozen`, `uv run pytest tests/ -v --cov=app --cov-report=term-missing` (backend); `pnpm test`, `pnpm run test:coverage` (frontend).
  Verify: all commands exit 0; coverage reports present.

---

TDD note: config/docs/tooling only, no testable application behavior — RED/GREEN/REFACTOR does not apply. Each task is verified by the deterministic command listed, per the non-testable-behavior exception in `openspec/config.yaml` (`apply.guidelines`).
