# Proposal: Production Readiness Cleanup (P0/P1 Hygiene)

## Intent

The repo cannot be deployed reliably today. `uv lock --check` fails on the
committed `backend/uv.lock` (drift vs `pyproject`'s `openai>=1.50.0`), which
breaks `uv sync --frozen` — the exact command CI (`.github/workflows/ci.yml`)
and `backend/Dockerfile` use. Any pipeline run or container build fails at
install. On top of that P0, several P1 hygiene gaps undermine a real club
management deployment: `backend/README.md` documents entities removed by PR
#113 (`clases_extra`, `SolicitudClaseExtra`), no `.env.example` exists despite
`.gitignore` and the README expecting one, `[tool.uv] dev-dependencies` uses
deprecated uv syntax, and neither stack reports test coverage. This change
restores a green, reproducible, honestly-documented baseline — no behavior
changes, no risky refactors.

## Scope

### In Scope
- Fix the `openai` lockfile drift so `uv lock --check` and `uv sync --frozen`
  pass (apply the fix already in `git stash@{0}`).
- Rewrite `backend/README.md` to current reality (drop `clases_extra` /
  `SolicitudClaseExtra` / `ClaseExtraServicio`, correct test count/description).
- Add `backend/.env.example` matching what `configuracion.py` reads; add a
  frontend `.env.example` for `NEXT_PUBLIC_*` vars if the frontend reads any.
- Migrate `[tool.uv] dev-dependencies` → `[dependency-groups]` in
  `backend/pyproject.toml`.
- Add coverage tooling: `pytest-cov` + `--cov` in the CI backend job; a
  coverage script/dependency on the frontend.
- Commit the untracked `docs/ux/` redesign docs (approved source of truth for
  a future change).

### Out of Scope (declared as future changes)
- Oversized-component refactor (`payments/page.tsx`, `student/enroll/page.tsx`,
  `services/api.ts`) — needs characterization tests given money/enrollment risk.
- Dashboard/attendance N+1 stash (`stash@{5}`) triage — needs a diff review vs
  current `main` first (#142 may have superseded it).
- `RankingResponseDTO` dead-field removal; the "la paleta" redesign.

## Capabilities

### New Capabilities
- None — config/docs/tooling only; no user-facing behavior specified.

### Modified Capabilities
- None — `openspec/specs/` is empty; no requirement-level behavior changes.

## Approach

Single PR, expected well under the 400-line budget; auto-chain only if it
exceeds. Work order: (1) apply/rebase `stash@{0}`, run `uv lock --check` +
`uv sync --frozen` to confirm green; (2) migrate uv config key; (3) add
coverage tooling on both stacks; (4) rewrite README against current routers/
entities; (5) author `.env.example` files from `configuracion.py` and the
frontend env reads; (6) commit `docs/ux/`. Every item is independently
verifiable via a passing build / install / coverage report.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `backend/uv.lock` | Modified | Re-synced to include `openai`; `--frozen` passes |
| `backend/pyproject.toml` | Modified | `[tool.uv]` → `[dependency-groups]`; add `pytest-cov` |
| `backend/README.md` | Modified | Remove PR #113 entities; correct test count |
| `backend/.env.example` | New | Matches `configuracion.py` |
| `frontend/.env.example` | New | `NEXT_PUBLIC_*` vars (if read) |
| `.github/workflows/ci.yml` | Modified | `--cov` in backend job |
| `frontend/package.json` | Modified | Coverage script/dependency |
| `docs/ux/` | New (tracked) | Commit approved redesign docs |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `stash@{0}` no longer applies cleanly on current `main` | Med | Re-resolve/regenerate the lock via `uv lock`; validate with `--check` |
| Frontend has no runtime env vars, making a frontend `.env.example` pointless | Med | Confirm against `next.config`/Dockerfile ARGs before adding; skip if none |
| `.env.example` leaks a real secret value | Low | Use placeholders only; diff-review before commit |
| Adding coverage flips CI red on a low baseline | Low | Report coverage, do not gate (`coverage_threshold: 0`) |

## Rollback Plan

Single revertable PR touching only config, docs, and CI. `git revert` restores
the prior state with zero blast radius on application code. The lockfile can be
regenerated at any time with `uv lock`.

## Dependencies

- `git stash@{0}` (the lockfile fix) and the untracked `docs/ux/` tree must
  still be present in the working environment when this change is applied.

## Success Criteria

- [ ] `uv lock --check` passes on the committed `backend/uv.lock`.
- [ ] `uv sync --frozen` succeeds locally, in CI, and in the Docker build.
- [ ] CI backend + frontend jobs are green.
- [ ] Coverage totals reported on both stacks.
- [ ] `backend/README.md` references no removed entity and states the correct
      test count.
- [ ] `.env.example` file(s) match every key read by `configuracion.py` (and
      frontend env reads, if any).
- [ ] `[dependency-groups]` replaces `[tool.uv] dev-dependencies`.
- [ ] `docs/ux/` is tracked in git.
