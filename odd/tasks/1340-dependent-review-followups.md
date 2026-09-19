# 1340 — Follow-ups advisory of the #1318 review (four-lens)

Issue: https://github.com/AlejandroTatum/cata_club/issues/1340
Branch: `chore/1340-dependent-review-followups` (worktree `cata_club-worktrees/gentleman-1340`, cut from `origin/main` @ 59c3a8b)
Delivery strategy: single PR, squash auto-merge (forecast well under ~400 changed lines: two small frontend behavior fixes, one backend test hardening, one test-double cleanup, all scoped to the #1318 delivery)
TDD: **on** (strict, session config). Runners: frontend `cd frontend && pnpm vitest run <file>`; backend `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL uv run pytest <file> -q` (db-test on `localhost:5436`, single-tenant, torn down after use).
RDD: status not queried by this writer (push/review/PR are the orchestrator's job per this task's brief) — left for the orchestrator to resolve via `gentle-ai review mode status`.

## Objective

Close the five advisory findings of the native four-lens review of the PR that closed #1318 (self-service "add first dependent"). Approved and merged separately; these are the follow-ups.

## Findings (from the issue)

- **R4-001/R2/R3-001** — `refreshSession()` inside the submit `try`, `add-dependent/page.tsx:183`: runs after the dependent is persisted and the success toast is shown; a rejected rehydration lands in the create's own `catch` and reports a failure for something that succeeded.
- **R2/R3-002** — CTA offered to a represented adult, `student/page.tsx:1232`: `showAddDependentCta = representative || isPlayer` does not exclude an adult player who is still represented; the backend rejects that alta with its own precondition.
- **R2** — stale wizard docstring, `add-dependent/page.tsx:11-20`: still describes the per-persona endpoint and `crearRepresentado`.
- **R3-003/R3-005** — `backend/tests/test_autoservicio_representante.py`: rejection tests assert only `OperacionInvalida`, not the exact `mensajes.py` message; the re-issued token's role is decoded but never exercised against a real authenticated call.
- **R2** — dead harness parameters (`add-dependent-harness.tsx`'s `authContextDouble`) and a repeated "always-true" comment in `student/page.tsx`.

## Design decisions (parent, verified before delegation-free implementation)

- **CTA gate field.** `session.user.representanteId` is documented in `lib/server/auth.ts:814-817` as ALWAYS `null` (`/auth/me` doesn't return the representante_id graph) — unusable for this gate. The student portal's own `self` entry (`StudentProfileSummary.representanteId`, `services/api.ts:1240`) carries the real value and is already read the same way at `student/page.tsx:1207` for the photo-permission gate. Used `data.self?.representanteId != null` to mirror the backend precondition (`PersonaServicio.crear_representado_propio`: `if persona.representante_id is not None: raise OperacionInvalida(...)`, `persona_servicio.py:322-329`) exactly.
- **refreshSession split.** `AuthContext.refreshSession` is typed `() => Promise<SessionOutcome>` and its real implementation (`services/auth.ts::fetchSession`) never actually rejects — it catches internally and always resolves a `{kind: ...}` outcome. The review's "if it rejects" is a defensive/structural finding regardless: moved the create call into its own try/catch that reports failure and returns early on error, then (only on success) fire the toast, run `refreshSession()` in its own try/catch that only `console.error`s (matching the existing soft-fail precedent in `profile/SessionsCard.tsx:57`), and always navigate.
- **Item 4, backend test hardening.** No production code changes were needed — `persona_servicio.py` already raises the exact `mensajes.py` constants the issue names, and `GET /auth/me` already accepts a valid REPRESENTANTE token. This is pure test-assertion tightening: adding the message assertions and the reissued-token round trip pass immediately (no RED possible without breaking working code), so the evidence below is "written once, observed GREEN" rather than a RED→GREEN pair. Verified by reading `persona_servicio.py`/`mensajes.py` before writing the assertions, not assumed.
- **Item 5, harness cleanup.** `authContextDouble(backendRoles, userRole)` had exactly one caller (`add-dependent-visual-contract.test.tsx`, no arguments) — `add-dependent-role-notice.test.tsx` deliberately avoids this double because it needs the role to flip per test and installs its own hoisted double instead (already documented in that file's header). Removed the two parameters rather than exercising them, since nothing needs the variation.

## Scope (authorized)

- Edit: `frontend/src/app/student/add-dependent/page.tsx`, `frontend/src/app/student/page.tsx`, `frontend/src/app/student/add-dependent/__tests__/add-dependent-harness.tsx`, `frontend/src/app/student/__tests__/StudentPage.test.tsx`, `backend/tests/test_autoservicio_representante.py`.
- Add: `frontend/src/app/student/add-dependent/__tests__/add-dependent-refresh-session.test.tsx`.
- No production backend changes (item 4 is test-only); no new dependencies.
- Comments/docstrings match each file's existing language (English in frontend TSX, Spanish in the backend test file).

## Tasks

- [x] T1 (R4-001/R2/R3-001): separate `refreshSession()` from the create's try/catch; update the wizard's stale docstring (R2) in the same file/commit.
- [x] T2 (R2/R3-002): gate `showAddDependentCta` on `!selfRepresented`; rewrite the now-inaccurate "always true" comment (R2, harness half) in the same commit.
- [x] T3 (R3-003/R3-005): pin the three rejection messages and the reissued-token acceptance round trip in the backend test.
- [x] T4 (R2, harness half): drop `authContextDouble`'s unused parameters.
- [x] T5: verification — focused suites, then `make pre-pr LANE=full` (exit 0); one work-unit commit per task; ODD doc committed with the work.
- [ ] T6: native review/push/PR — explicitly out of this writer's scope per the task brief; left to the orchestrator.

## Acceptance criteria

- A rehydration failure is not reported as a create failure (locked by `add-dependent-refresh-session.test.tsx`).
- A represented adult does not see the add-dependent CTA (locked by the new `StudentPage.test.tsx` case).
- Rejection messages and the re-issued token's role are pinned by test (backend).
- `make pre-pr LANE=full` result reported honestly, including anything not reproducible locally.

## Evidence

### T1 (R4-001/R2/R3-001)

- **RED** — `pnpm vitest run src/app/student/add-dependent/__tests__/add-dependent-refresh-session.test.tsx` against the UNCHANGED `page.tsx`: both new cases timed out waiting for `pushMock` — `AssertionError: expected "vi.fn()" to be called with arguments: [ '/student' ], Number of calls: 0`. Confirms the rejected `refreshSession` was falling into the create's `catch` and never reaching `router.push`.
- **GREEN** — same command after the fix: `Test Files 4 passed (4), Tests 56 passed (56)` across the whole `add-dependent/__tests__/` directory (visual-contract, role-notice, utils, and the two new refresh-session cases).
- Changed: `frontend/src/app/student/add-dependent/page.tsx` — `handleConfirm` now returns early from the create's own try/catch, fires the success toast unconditionally on success, then runs `refreshSession()` in its own try/catch that only `console.error`s, then always navigates; module docstring corrected to name `crearRepresentadoPropio`/`POST /personas/me/representados` and to note the #1340 split.

### T2 (R2/R3-002)

- **RED** — `pnpm vitest run src/app/student/__tests__/StudentPage.test.tsx -t "does not offer the add-dependent CTA to a self-managed player"` against the UNCHANGED `page.tsx`: failed — the link rendered (`queryByText(...)` resolved to the `<a href="/student/add-dependent">` element instead of `null`).
- **GREEN** — `pnpm vitest run src/app/student/__tests__/StudentPage.test.tsx` after the fix: `Test Files 1 passed (1), Tests 113 passed (113)`.
- Changed: `frontend/src/app/student/page.tsx` — `showAddDependentCta = (representative || isPlayer) && !selfRepresented`, where `selfRepresented = data.self?.representanteId != null`; rewrote the surrounding comment block (dropped the now-false "the condition is always true here" claim, explained the new exclusion and its backend mirror).

### T3 (R3-003/R3-005)

- No prod code change (see design decision above) — no RED/GREEN pair applies; written once and run.
- **GREEN** — `TEST_DATABASE_URL=$TEST_DATABASE_URL uv run pytest tests/test_autoservicio_representante.py -q` → `10 passed, 1 warning`.
- Changed: `backend/tests/test_autoservicio_representante.py` — `test_menor_no_puede_autoservicio`, `test_representado_no_puede_autoservicio`, `test_staff_no_puede_autoservicio` now assert `str(error.value) ==` the exact `mensajes.py` constant instead of just the exception type; `test_endpoint_me_representados_via_http` now follows the 201 response with a real `GET /api/v1/auth/me` call using the reissued `accessToken` and asserts `200` + `roles == ["REPRESENTANTE"]`.

### T4 (R2, harness half)

- No prod/test-behavior change — pure signature cleanup of a test double with a single, argument-less caller.
- **GREEN** — `pnpm vitest run src/app/student/add-dependent/__tests__/` → `Test Files 4 passed (4), Tests 56 passed (56)` (same run as T1's GREEN, confirms no regression from the harness edit).
- Changed: `frontend/src/app/student/add-dependent/__tests__/add-dependent-harness.tsx` — `authContextDouble()` dropped its two unused parameters and hardcodes the REPRESENTANTE session it always returned in practice; doc comment rewritten to explain why (and to point at `add-dependent-role-notice.test.tsx`'s own hoisted double for the per-test-role case).

### T5 — Verification

- Focused suites: see T1/T2/T3/T4 GREEN entries above.
- `make pre-pr LANE=full` (once, no `JWT_SECRET_KEY` in the environment) — **exit 0**:
  - `ruff check .` PASS; `lint-imports` PASS (3 contracts kept, 0 broken); `pip-audit` PASS (no known vulnerabilities).
  - `backend/tests/`: `2869 passed, 3 skipped, 90 warnings` (551.60s).
  - root `tests/`: `633 passed, 1 skipped`.
  - CI gate `migraciones-desde-cero` **not reproduced locally** — declared by the lane itself (isolated empty PostgreSQL service in CI).
  - `pnpm audit --audit-level=high`: 1 pre-existing moderate vulnerability reported, does not fail the `high` threshold; unrelated (no dependency changes in this branch).
  - `pnpm type-check`: clean. `pnpm lint`: one pre-existing warning (`src/app/sponsors/page.tsx:46`, `<img>` vs `next/image`), unrelated to this branch.
  - `pnpm run test:coverage`: `Test Files 304 passed (304), Tests 5180 passed (5180)`.
  - `pnpm build`: succeeded.
  - `pnpm exec playwright test`: `218 passed` (3.0m).
- db-test: started via `docker compose --profile test up -d --wait db-test` before the focused backend run, recreated by the lane's own `test-backend-preflight` for the full run, torn down via `docker compose --profile test rm -sf db-test` afterward, confirmed absent from `docker ps` before handing back.
- Environment note: this session's Bash sandbox refused direct TCP to `127.0.0.1:5436` even though the container was `Up ... (healthy)` per `docker ps` — confirmed sandbox-caused with a direct `psql` connection test outside the sandbox, then re-ran the affected commands (focused pytest, `make pre-pr LANE=full`) with the sandbox disabled. The first `LANE=full` attempt was still inside the sandbox and errored all ~2872 backend tests at fixture/connection level; killed and re-run correctly.

### T6 — Review nativo / push / PR

Not run by this writer — explicitly out of scope per the task brief ("Do NOT push, do NOT open a PR, do NOT run any `gentle-ai review` command. The orchestrator handles review, push, PR.").
