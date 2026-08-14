# Exploration: production-readiness-cleanup

## Current State

The repo is a monorepo: `backend/` (FastAPI 0.115, SQLAlchemy 2.0, Pydantic v2, PostgreSQL/psycopg3, Alembic, pytest, uv) and `frontend/` (Next.js 14 App Router, TypeScript, Vitest, Playwright, pnpm). PR #113 removed the "ranking competitivo / selección oficial / clase extra" features. That removal was executed unusually well: Alembic migration `d4e5f6a7b8c9_remover_clase_extra_y_ranking_competitivo.py` cleanly drops the 3 orphan tables, the 3 orphan columns, and the 2 orphan Postgres enum types, with a docstring explaining exactly what's kept and why. `ranking_servicio.py`, `ranking_schemas.py`, `ranking_repositorio.py`, and `tests/test_ranking.py` all carry accurate docstrings stating what was removed and what remains (level/group assignment only). **This part of the codebase is not a cleanup target** — it's a template for how the rest of the removal should have been documented.

The real gaps are elsewhere: a lockfile/pyproject drift that currently breaks `--frozen` installs (CI and Docker both use `--frozen`), a stale README describing entities that no longer exist, no `.env.example` despite `.gitignore` and the README expecting one, no coverage tooling on either stack, and a deprecated `uv` config key.

## Affected Areas

- `backend/pyproject.toml:29` / `backend/uv.lock` — `openai>=1.50.0` declared, absent from lock (grep of `uv.lock` confirms no `name = "openai"` entry). Breaks `uv sync --frozen`.
- `.github/workflows/ci.yml:32` — `uv sync --frozen` in the backend job; will fail with the above drift.
- `backend/Dockerfile:10,13` — `uv sync --frozen` (twice); same failure mode, breaks the container build too.
- `backend/README.md:21,44,60,66-74` — documents `clases_extra` router, `SolicitudClaseExtra` entity, `ClaseExtraServicio`, "39 pruebas" — all removed/outdated by PR #113 and later work.
- Repo root — no `.env.example` anywhere (`Glob **/*.env*` → no results), yet `.gitignore:4` has `!.env.example` and `backend/README.md:13` instructs `cp .env.example .env`.
- `backend/pyproject.toml:32-36` — `[tool.uv] dev-dependencies` (deprecated uv syntax; should move to `[dependency-groups]`).
- `backend/pyproject.toml` dev deps / CI — no `pytest-cov`; `frontend/package.json` — no coverage devDependency or script (`pnpm test` = plain `vitest run`).
- `backend/app/servicios_negocio/ranking_servicio.py:61-78` — `listar_niveles_con_ocupacion` issues one `COUNT` per nivel in a loop (bounded ~10, low severity) — possible but unconfirmed match for the stashed N+1 fix.
- `backend/main.py` — no centralized `logging.basicConfig`/`dictConfig`; only some Celery task modules under `infraestructura/tareas/` call `logging.getLogger` ad hoc.
- `frontend/src/app/student/enroll/page.tsx` (863 lines), `frontend/src/app/payments/page.tsx` (799 lines), `frontend/src/services/api.ts` (1288 lines, 54 exports) — oversized files, already partly flagged in the archived `admin-usability-heuristics` exploration for UX reasons, also a maintainability hotspot.
- `backend/app/presentacion/schemas/ranking_schemas.py:56-74` — `RankingResponseDTO.puntaje_acumulado`/`posicion_actual` kept only for response-shape compatibility, no consumer reads them (per its own docstring) — a documented, low-risk dead-field candidate.

## Approaches

1. **Single cleanup change covering only P0/P1 hygiene items** (lockfile fix, README rewrite, `.env.example` creation, uv dependency-groups migration, add coverage tooling) — no behavior changes, no risky refactors.
   - Pros: Small, safe, reviewable in well under the 400-line PR budget; unblocks CI/Docker immediately; every item is independently verifiable (build passes, `uv sync --frozen` succeeds, coverage report appears).
   - Cons: Doesn't touch the oversized-file or N+1 findings.
   - Effort: Low.

2. **Cleanup change + oversized-component refactor + N+1 investigation in one change.**
   - Pros: Single pass over "production readiness."
   - Cons: Mixes a zero-risk fix (lockfile) with a high-risk refactor (splitting 800+ line payment/enrollment components) in the same review; blows past the 400-line PR budget; the N+1 candidate needs the actual stash diff reviewed before any code is touched, which is investigation work, not cleanup work.
   - Effort: High.

3. **Split into this cleanup (P0/P1 only) + two follow-up changes**: (a) a dedicated "large-component refactor" change for `payments/page.tsx` and `student/enroll/page.tsx` with characterization tests first, and (b) a dedicated "dashboard/attendance N+1" change that starts by diffing `stash@{5}` against current `main` to determine if it's still needed post-#142.
   - Pros: Keeps this change small and safe; defers genuinely risky work (payments/enrollment refactor touches money and enrollment flows) to changes that can budget proper regression testing; the N+1 stash needs its own triage step before it can even be scoped.
   - Cons: More changes to track.
   - Effort: Low (this change) + Medium/High (deferred).

## Recommendation

Approach 3. Scope **production-readiness-cleanup** to the P0/P1 items only:

- Fix the `openai` lockfile drift (apply/rebase stash@{0}, verify `uv sync --frozen` succeeds, confirm CI backend job and Docker build both pass).
- Rewrite `backend/README.md` to match current reality (drop `clases_extra`/`SolicitudClaseExtra` references, correct test count/description).
- Add `backend/.env.example` and (if missing) a frontend equivalent for `NEXT_PUBLIC_*` vars, matching what `configuracion.py` and `next.config`/Dockerfile ARGs actually read.
- Migrate `[tool.uv] dev-dependencies` to `[dependency-groups]`.
- Add `pytest-cov` to backend dev deps + `--cov` in CI; add a coverage script/dependency on the frontend; report both totals per the testing-coverage skill.

Explicitly exclude from this change: the oversized `payments/page.tsx`/`student/enroll/page.tsx` refactor (separate change, needs characterization tests given money/enrollment risk) and the dashboard N+1 stash (separate change — first step is a plain `git stash show -p stash@{5}` diff review against current `main`, since the current dashboard/attendance read paths already look clean and #142 may have superseded it).

## Risks

- The exact target of `stash@{5}`'s N+1 fix is inferred from static review, not confirmed from the diff itself. Whoever scopes the N+1 follow-up change must read the actual stash diff first.
- `uv sync --frozen` failing is inferred from `openai` being absent from `uv.lock` plus `--frozen`'s documented semantics (exact lock match required) — not confirmed by running the command during exploration.
- Removing `RankingResponseDTO`'s dead `puntaje_acumulado`/`posicion_actual` fields touches a public API response shape (`/ranking/asignar-nivel-inicial`, `/ranking/mover-de-nivel`) — safe per the docstring's claim of "no consumidor... los lee," but that claim should be re-verified against the current frontend before removing, not just trusted.
- `docs/ux/` (untracked) and `stash@{0}` are pre-existing, approved, intentional artifacts — excluded from findings as instructed.

## Ready for Proposal

Yes. Findings are concrete and file/line-grounded. Recommend `sdd-propose` scope the change exactly as in the Recommendation section above (lockfile fix, README, `.env.example`, uv dependency-groups migration, coverage tooling) and explicitly declare the oversized-component refactor and the dashboard N+1 stash triage as out-of-scope, future changes.
