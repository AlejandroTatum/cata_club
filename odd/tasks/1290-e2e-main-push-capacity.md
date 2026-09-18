# #1290 — E2E main-push capacity

## Status

Committed, pending native review and PR.

## Root class

Bucket C: CI E2E capacity. Four Playwright workers share a four-vCPU runner and one Next.js standalone server. The reported failures are `page.goto` test-budget expirations on otherwise unrelated `main` pushes.

## Scope

- Reproduce the two named public-navigation specs under the CI worker shape.
- Prefer reducing contention over increasing the 30-second test budget.
- Keep the full push-to-main matrix contract unchanged.
- Do not add route-specific warm-up or another readiness mechanism unless evidence disproves capacity contention.

## Closure evidence

- [x] A repository test locks the selected concurrency contract.
- [x] Focused CI-shaped Playwright command recorded.
- [x] `make pre-pr LANE=frontend` passes.
- [ ] Native review closes without findings.
- [x] Work-unit commit recorded on `fix/1290-e2e-main-push-workers`
      (self-reference amended in; run `git log -1` for the exact hash).

## TDD and runtime evidence

- RED (before the fix, `uv run --frozen --no-build pytest ../tests/test_playwright_config.py`):
  `1 failed, 8 passed` — `AssertionError: los workers de CI deben ser 2, son 4`
  in `TestConcurrenciaDeclarada::test_ci_baja_la_concurrencia_por_debajo_de_los_vcpu`.
  That run predates the review corrections, so it exercised 9 tests; today's
  equivalent behavioral gate is
  `TestElGateNoEsVacio::test_volver_a_cuatro_workers_en_ci_pone_el_gate_rojo`.
- GREEN (after `workers: process.env.CI ? 2 : 1`, post-corrections):
  `7 passed in 0.04s` for `pytest ../tests/test_playwright_config.py -q`, and
  `31 passed in 0.19s` together with `../tests/test_e2e_live_workflow.py -v`.
  `ruff check` on both files: `All checks passed!`.
- TRIANGULATE: four mutation cases remain — CI back to 4 workers, ci workers
  above the runner's 4 vCPU, local workers moved off 1, and an unparseable
  config — each asserted to turn the gate red. The vCPU assertion is reachable
  only through `esperado_ci=8`, so the mutation cannot be satisfied by the
  equality check alone.
- Focused runtime: `CI=1 taskset -c 0-3 pnpm exec playwright test
  legal-header-session.spec.ts site-navigation.spec.ts --reporter=line` —
  diagnostic `--workers=4`: `3 passed (9.3s)`, exit 0, 10s wall; candidate
  (config value): `3 passed (4.7s)`, exit 0, 6s wall. Chrome pinned to CPUs
  0-3 to approximate the 4-vCPU runner.
- Diagnostic limit: Playwright reported `using 2 workers` under `--workers=4`
  because `fullyParallel: false` caps parallel workers at the number of test
  FILES (2 here). The 4-vs-2 contention hypothesis was therefore NOT reproduced
  at runtime; this shape cannot distinguish the two settings, and only the
  policy contract is verified. No failure occurred, so nothing needed
  classification.

## Evidence calibration (independent verifier)

- The two identical `page.goto` expirations on unrelated `main` pushes are
  **consistent with** CPU contention, not proof of it. The config rationale and
  the contract test's docstring now say so explicitly, and no longer claim the
  landing was requested four times or that concurrency is the cause.
- `workers: 2` is the **selected conservative operational policy** and the
  exact frozen contract — not a derived optimum. Local stays at 1.
- Removed the `PLAYWRIGHT_WORKERS` assertion: the config never read that
  variable, so the gate could not fail for a real regression.
- Removed `test_los_workers_locales_siguen_en_uno`: the local-worker assertion
  inside `verificar_concurrencia` already covers it, and the local mutation gate
  proves it is reachable.
- Fixed the citation that this change invalidated:
  `tests/test_e2e_live_workflow.py` now points at
  `frontend/playwright.config.ts:37,61` (retries, trace), verified against the
  file after rewording.

## Authored change

- `frontend/playwright.config.ts`: +9/-1 (CI workers 4 -> 2, calibrated
  rationale in the existing comment block).
- `tests/test_playwright_config.py`: 133 new lines (contract + 4 mutation gates).
- `tests/test_e2e_live_workflow.py`: +1/-1 (stale line citation).
- Total authored: 143 changed lines, over the 100-line forecast in Delivery
  strategy; the reviewer should weigh splitting the contract file.

## Lane evidence

- Prerequisites: `pnpm install --frozen-lockfile` (`Done in 1.7s`) with
  `frontend/pnpm-lock.yaml` byte-identical afterwards (no lockfile diff);
  Chromium already present at
  `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` — no browser
  install needed. CI-shape server prepared as the workflow does:
  `pnpm build` (`build_exit=0`, 64s) + `cp -r public … && cp -r .next/static …`.
- `make pre-pr LANE=frontend`: exit 0, **942s** (15.7m). Guard-secrets,
  `pnpm audit --audit-level=high`, type-check, lint, unit+coverage, build and
  the full Playwright suite all passed; E2E was `218 passed (4.7m)`.
- Independent re-verification in a fresh worktree (`gentleman-1290`) reproduced
  a transient failure on the first `make pre-pr LANE=frontend` run:
  `landing-no-third-party.spec.ts` line 67 (`state?.decoded` false), `217
  passed, 1 failed (3.8m)`. That spec is unrelated to this change (last
  touched in a prior PR) and passed in isolation
  (`pnpm exec playwright test landing-no-third-party.spec.ts`, `2 passed`).
  A full second `make pre-pr LANE=frontend` run was clean: `218 passed (3.8m)`,
  exit 0. Classified as a pre-existing image-decode timing flake under local
  load, not a regression from `workers: 2`.
- Worker shape of that lane: `CI` is unset locally, so the config ran
  `workers: 1`; the CI shape (workers 2, retries 1, standalone server) was
  covered by the focused runs above, not by the lane.
- CI gates NOT reproduced locally: `migraciones-desde-cero` (isolated empty
  PostgreSQL), `docker-images` (production-image build, real boot,
  diagnostics, GHCR publication), the `dorny/paths-filter` job, branch
  protection, and artifact upload/retention.

## Recommended lane

`make pre-pr LANE=frontend` (build + full E2E + frontend unit/lint). Root test
file itself is also covered by `make test-root` inside the backend lane.

## Delivery strategy

Single PR; forecast under 100 authored changed lines.

## Rollback boundary

Remove only the Playwright CI concurrency setting and its contract test/documentation in this task. Do not revert the separate hero image warm-up from #1302.
