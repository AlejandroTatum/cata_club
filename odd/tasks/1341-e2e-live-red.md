# 1341 — E2E Live (QA stack): el cron diario está rojo desde el 14/09 con los mismos cinco specs

Issue: https://github.com/AlejandroTatum/cata_club/issues/1341
Branch: `test/1341-e2e-live-red` (worktree `cata_club-worktrees/gentleman-1341`, cut from `origin/main` @ 59c3a8b)
Delivery strategy: single PR (forecast well under 400 changed lines; one spec file touched)
TDD: **on** (strict, session config). Runner: `cd frontend && E2E_LIVE=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test --project=e2e-live` against the local QA stack (`make qa-up`/`qa-down`, project `cataclub-qa`).
RDD: not evaluated by this writer — the orchestrator handles review/PR/merge; this task stops at a verified branch.

## Objective

Reproduce the five specs that have failed the daily "E2E Live (QA stack)" cron since 2026-09-14, classify each with evidence, fix what is a stale/outdated spec, and report (without fixing) whatever is a real product or environment defect.

## Reproduction

- Latest scheduled run: `35439011716` (2026-09-19, on `eab88c1`) — 5 failed, 17 passed, "Bring up the QA stack" green, "Run live E2E specs" red.
- Local: tore down a stale `cataclub-qa` stack (bound to the main checkout, 15h old, idle — not one of the sibling worktrees `gentleman-1337`/`gentleman-1340`), then `make qa-up` from this worktree (HEAD == origin/main, verified by `qa_verify_build_sha.py`), then `make qa-live` (single worker locally; CI runs `workers: 2, retries: 1`, see `frontend/playwright.config.ts:35-52`).
- First local run (before any fix): **4 failed** — `discount-payment-effect.live.spec.ts:443`, and all three `transfer-payment-comprobante.live.spec.ts` tests (102, 152, 188). `payments.live.spec.ts:66` **passed** locally on the first try (CI-only failure, see classification).

## Classification (evidence-based)

| Spec | Class | Evidence |
| --- | --- | --- |
| `discount-payment-effect.live.spec.ts:443` (HALLAZGO del beneficio 100%) | **(a) spec outdated** | Pinned the pre-#1336 bug: `toHaveText(coberturaAntes)` expected the coverage date to stay unchanged after applying a 100% benefit. Local RED before the fix: `Expected: "Pagado hasta el 28/09/2026" / Received: "Pagado hasta el 28/10/2026"` — the screen now correctly advances the date. Code evidence: `frontend/src/app/student/payments/page.tsx:2008-2017` reads `MembershipSummary.cubiertoHasta` (issue #1328, `PagoServicio._fecha_fin_maxima_combinada`) as the PRIMARY coverage source since #1336, with `resolveCoverageEnd` (Pago-only) kept only as a fallback. |
| `payments.live.spec.ts:66` (pago en efectivo) | **(c) flakiness** | Failed both CI runs (18/09, 19/09) with `locator.click: Test timeout of 30000ms exceeded` / "element was detached from the DOM, retrying" on the "Registrar un pago" button. Passed cleanly in 2 separate local single-worker runs. `playwright.config.ts:35-52`: CI forces `workers: 2` (this file's tests run concurrently with another live-spec file sharing 4 vCPUs and one Next standalone server), local defaults to `workers: 1`. Consistent with the CPU-contention pattern already documented in that same config file's comments. Not reproduced locally; left red, no code change. |
| `transfer-payment-comprobante.live.spec.ts:102` (registrar transferencia con comprobante, UI) | **(b) real defect — environment, shared root cause with 152/188** | Reproduced locally, deterministically, 3/3 runs. Backend log at failure time: `ERROR cataclub.cloudinary ... Fallo subiendo voucher de pago (pago_id=75, ...) a Cloudinary: Must supply api_key` → `POST /api/v1/membresias/pagos/75/voucher HTTP/1.1" 503`. The UI's voucher upload hits the same endpoint as 152/188 below. |
| `transfer-payment-comprobante.live.spec.ts:152` (Celery genera PDF real en Cloudinary) | **(b) real defect — environment** | `Error: No se pudo adjuntar el comprobante al pago 74/80: 503` at the PRECONDITION step (`registerTransferPaymentViaApi`), before the Celery/public_id assertion is ever reached. Same backend log line as above (`Must supply api_key`). The issue's hypothesis ("revisarlo contra el public_id nuevo de #1327") does not hold: `backend/app/infraestructura/tareas/comprobante_tareas.py:51-100` already computes `comprobante-{id:08d}-{12-hex-hash}` (issue #1327), and the test never asserts an exact `public_id` string — it only checks `comprobanteOficialUrl` is truthy, which is never reached because the precondition upload 503s first. |
| `transfer-payment-comprobante.live.spec.ts:188` (rechazar pago con motivo) | **(b) real defect — environment, same root cause** | Same precondition helper, same `Must supply api_key` 503 (`pago_id=72/81`). |

### Root cause of the three `transfer-payment-comprobante` failures

`docker-compose.yml:109-111` reads `CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`/`CLOUDINARY_CLOUD_NAME` from `${VAR:-}` (empty default). `.github/workflows/e2e-live.yml`'s own header comment states the design intentionally: *"no declara NINGUNA credencial del repositorio... Un token acá sería permiso pedido de más"* — the workflow's `permissions: contents: read` and lack of any `env:`/`secrets:` block for `CLOUDINARY_*` mean the scheduled run's QA stack can **never** have real Cloudinary credentials. The spec file's own header claims *"Cloudinary SÍ está configurado en este entorno de QA... Confirmado en vivo"* — true for whoever wrote it against their own local `.env`, but not true for the automated cron, and not true for this fresh worktree's `.env` either. This is one environment/workflow-design gap causing all three failures, not three separate product bugs. Not fixed here (environment/workflow-secrets decision, out of a spec-writer's scope, and touching `.env`/workflow secrets is outside this task's authorized scope).

## Fix applied

`frontend/tests/e2e/discount-payment-effect.live.spec.ts` — inverted the third test (issue #1341, citing #1328/#1336 in the header and test title):
- Renamed from `"HALLAZGO: ... y la pantalla del alumno no lo refleja"` to `"... y la pantalla del alumno la refleja (issue #1328, #1336)"`.
- Replaced the `toHaveText(coberturaAntes)` assertion (expects no change — the old bug) with: read `cubiertoHasta` from `GET /api/student?personaId=...` (the same source the screen itself reads per `student/payments/page.tsx:2014`), format it with a small local `dd/mm/yyyy` helper (mirrors `src/lib/format-utils.ts::formatDate`'s date-only path; not imported directly — no e2e spec resolves the `@/` alias), and assert the `<h2>` matches that value AND differs from `coberturaAntes`.
- Fixed the cleanup 401 (`Error: No se pudo retirar el beneficio: 401 Token inválido o expirado`, seen in CI's retry #1): the `finally` block now re-authenticates as admin (`page.request.post("/api/auth/login", ...)`) immediately before `retirarBeneficio`, same pattern `helpers/pending-payments.ts::rejectPendingPayments` already uses. Root cause, from code (`backend/app/servicios_negocio/auth_servicio.py:601-615`, `_bombear_epoch_sesion`): logout bumps `version_sesion` for the WHOLE user account and invalidates every access/refresh token issued anywhere for it — with CI's `workers: 2`, `logout.live.spec.ts` logging out `admin@cataclub.com` in one worker can invalidate this test's idle admin `page` session in the other worker mid-flight. Not reproduced locally (single worker, no concurrent admin logout in flight) — the re-login is a resilience fix matching an existing codebase pattern, not something the local run could prove RED/GREEN on its own; the pre-fix CI log is the RED evidence.
- Updated the file's header comment (the "Cobertura bonificada" section) to state the behavior is now fixed by #1328/#1336 instead of documenting it as an open HALLAZGO.

## Scope (authorized)

- Edit: `frontend/tests/e2e/discount-payment-effect.live.spec.ts` only.
- No changes to `transfer-payment-comprobante.live.spec.ts`, `payments.live.spec.ts`, `.github/workflows/e2e-live.yml`, or any `.env`/secrets.
- No GitHub issues created (orchestrator's job).

## Tasks

- [x] T1 — Reproduce all five failing specs locally against a fresh QA stack from `origin/main`; capture RED evidence (CI logs + local run).
- [x] T2 — Classify each spec with evidence (table above).
- [x] T3 — Invert `discount-payment-effect.live.spec.ts:443` to assert the #1336 behavior; fix its cleanup 401.
- [x] T4 — Verify: inverted spec GREEN in isolation and in the full suite; `type-check`/`lint` clean on the changed file.
- [x] T5 — Report defects to open (3× `transfer-payment-comprobante`, shared Cloudinary-credentials root cause) and the flaky spec (`payments.live.spec.ts:66`) without fixing them.
- [x] T6 — Recommend the smallest cron-alerting option (no implementation).
- [x] T7 — Tear down the QA stack; leave a clean tree; commit.

## Acceptance criteria

- The inverted spec passes against the local QA stack, both alone and inside the full `qa-live` run.
- `pnpm type-check` and `pnpm exec eslint` clean on the changed file.
- Every spec left red has a documented classification and evidence (log lines, code references), not a guess.
- No product code changed; no `.env`/workflow files touched.

## Evidence

### T1/T2 — Reproduction

- CI run `35439011716` (2026-09-19): `gh run view 35439011716 --log-failed` → 5 failed (discount-payment-effect:443, payments:66, transfer-payment-comprobante:102/152/188), 17 passed (2.3m), "Run live E2E specs" step exit 2.
- Local `make qa-up` (fresh, HEAD `59c3a8b` == `origin/main`, `qa_verify_build_sha.py` PASS) + `make qa-live` (1 worker): first run **4 failed** (discount-payment-effect:443 + all 3 transfer-payment-comprobante), `payments.live.spec.ts:66` **passed**. `discount-payment-effect:443` local RED: `Expected: "Pagado hasta el 28/09/2026" / Received: "Pagado hasta el 28/10/2026"` (coverage correctly advanced — the old assertion is what's wrong).
- Backend log at the moment of each `transfer-payment-comprobante` failure (`docker compose -p cataclub-qa logs backend`):
  `ERROR cataclub.cloudinary ... Fallo subiendo voucher de pago (pago_id=74, public_id=voucher-pago-00000074-...) a Cloudinary: Must supply api_key` → `POST /api/v1/membresias/pagos/74/voucher HTTP/1.1" 503 Service Unavailable`. Reproduced for pago_id 71/72/74/75/80/81 across 3 separate runs (full suite ×2, isolated ×2).

### T3 — Fix

- `frontend/tests/e2e/discount-payment-effect.live.spec.ts`: test renamed and body inverted (see "Fix applied" above); header doc updated; added `formatFechaDDMMYYYY` local helper; cleanup re-authenticates before `retirarBeneficio`.

### T4 — Verification

- **GREEN, isolated**: `cd frontend && E2E_LIVE=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test --project=e2e-live tests/e2e/discount-payment-effect.live.spec.ts -g "issue #1328, #1336"` → `1 passed (7.6s)`.
- **GREEN, full suite**: `make qa-live` (final run) → `19 passed (1.1m)`, 3 failed (all `transfer-payment-comprobante.live.spec.ts`, the environment defect above — `payments.live.spec.ts:66` also passed this run, consistent with (c)).
- `cd frontend && pnpm type-check` → clean (tsc, no output).
- `cd frontend && pnpm exec eslint tests/e2e/discount-payment-effect.live.spec.ts` → clean (no output).
- Stack torn down: `make qa-down` (after final full run) — `docker compose -p cataclub-qa ps -a` empty.

### T5/T6 — Report (see PR body / final report to the orchestrator)

- Defects to open: one issue for the shared Cloudinary-credentials root cause (`transfer-payment-comprobante.live.spec.ts:102/152/188`), one for the `payments.live.spec.ts:66` CI-only flakiness (workers:2 CPU contention).
- Cron-alerting recommendation: smallest option is a single `actions/github-script` step (`if: failure()`) in `e2e-live.yml` that opens-or-comments-on one tracking issue per run, deduplicated by a fixed label/title (mirrors GitHub's own "auto-file on scheduled-workflow failure" idiom) — tradeoff: a `workflow_run` notification (e.g., to Slack/email) is even smaller to add but leaves no persistent, greppable record the way an issue comment thread does; a github-script step needs `issues: write` added to the otherwise deliberately credential-free workflow. Left to the orchestrator/product owner to decide.
