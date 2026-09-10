# Independent verification — PR 2 credential/capability slice (corrective rerun)

## Result Contract

**PR 2 verdict: PASS.** This corrective evidence supersedes the prior port-5436 validation block for the PR 2 slice only. The complete OpenSpec change remains **BLOCKED for archive** because later implementation and lifecycle tasks remain unchecked.

- Change/status: `represented-person-account-flow`; `artifactStore: openspec`; native verify state `ready`.
- Action context: `repo-local`; authoritative workspace and allowed edit root are this `pi-1137-pr2` worktree.
- Scope: base `4a60ca25312f0fa4a3074507e40b20be951651a7`, branch `fix/represented-person-credentials`, PR 2 only. No implementation file was modified during this verification.
- PostgreSQL: the old `pi-1137-db-test-1` was already stopped by the parent; this run created and used only `pi-1137-pr2-db-test-1` on exclusive port 5436. Stopping that old service did not discard or modify `pi-1137` WIP.

## Exact corrective validation

| Gate | Exact command | Result |
|---|---|---|
| Focused PostgreSQL GREEN | `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_auth.py tests/test_roles.py -q` | PASS — `20 passed, 1 warning in 6.47s` |
| Declared safety net | `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_rol_unico_por_cuenta.py tests/test_auth_registro_refresh.py tests/test_autenticacion_endpoints.py tests/test_admin_cuenta_servicio.py tests/test_auth.py tests/test_roles.py -q` | PASS — `92 passed, 1 warning in 15.27s` |
| Focused Ruff | `cd backend && uv run ruff check app/servicios_negocio/auth_servicio.py app/servicios_negocio/rol_servicio.py tests/test_auth.py tests/test_roles.py` | PASS — `All checks passed!` |
| Diff whitespace | `git diff --check 4a60ca25312f0fa4a3074507e40b20be951651a7` | PASS — no output / exit 0 |
| Canonical backend lane | `JWT_SECRET_KEY=verify-read-only TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test make pre-pr LANE=backend` | PASS — Ruff clean; import-linter `3 kept, 0 broken`; pip-audit `No known vulnerabilities found`; backend `2482 passed, 3 skipped, 328 warnings in 969.90s`; root `582 passed, 1 skipped in 25.73s` |

Skipped locally: CI job `migraciones-desde-cero` against its isolated empty PostgreSQL service, as reported by the canonical lane. No frontend lane applies to this backend-only PR 2 boundary.

## PR 2 behavior, boundary, and workload

- Credential core uses the supplied existing `Persona`, creates or updates exactly one `Usuario`, normalizes/rejects a foreign email, verifies the email, and has no token or `Persona` creation path.
- Capability core grants absent `REPRESENTANTE`, reuses the sole capability, explicitly replaces one legal role, rejects legacy multi-role state, and never grants `ALUMNO`.
- CodeGraph and zero-context production-diff review found no added `AdminCuentaServicio`, relationship-column assignment, `.commit()`, token emission, endpoint decorator, session epoch mutation, or revocation call. The added persistence is `Usuario`, role association, and `flush()` only.
- Implementation count is **637 additions + 1 deletion = 638 changed lines**: production `109 + 1` and two new test files `528 + 0`; this is within the 600–900 target and below the 1,000 hard stop. SDD bookkeeping is excluded.
- Boundary/rollback: revert the two core methods and two new tests against immediate parent PR 1; no migration, router, relationship, endpoint, or session behavior is included. Runtime is N/A because this slice has no endpoint/UI surface.

## Spec and design coverage

The PR 2 primitive boundary coheres with the design's existing-person credential and persisted `REPRESENTANTE` capability decisions. It deliberately does not claim PR 3 independence atomicity, relationship lifecycle, enrollment, player, contact, or remediation scenarios. The PR 2 tests cover the primitive obligations needed by the later adult-independence design: same `persona_id`, verified credential update/create, normalized-email conflict, rollback/commit ownership, role grant/reuse/replacement, legacy multi-role rejection, and no `ALUMNO`/relationship write.

## Strict TDD compliance

| Check | Result | Details |
|---|---|---|
| TDD Cycle Evidence table | PASS | Present in `apply-progress.md` with RED, GREEN, TRIANGULATE, and REFACTOR evidence for both PR 2 cores. |
| Test files and GREEN | PASS | `backend/tests/test_auth.py` and `backend/tests/test_roles.py` exist; current focused PostgreSQL execution is 20 passing cases. |
| Triangulation and safety net | PASS | Foreign normalized-email, rollback/commit, epoch, role replacement/reuse, catalog, and association identity cases are present; the declared six-file safety net passes 92 cases. |
| Assertion quality | PASS | No tautologies, ghost loops, type-only-only assertions, smoke-only tests, or CSS/implementation-detail assertions were found. Assertions call real service/ORM code and inspect durable behavior. |
| Test layers | PASS | 20 PostgreSQL service/ORM integration tests across 2 files; no UI/E2E layer is applicable to the core-only slice. |

Coverage was not separately run; it is informational and not required by the declared PR 2 validation contract.

## Task completion and archive status

`tasks.md:78-80` is complete for PR 2. The third PR 2 boundary/budget checkbox is now supported by the passing corrective gates and is marked complete. No other task checkbox is changed by this verification.

The following unchecked implementation/lifecycle scope remains and is a **CRITICAL archive blocker**, not a defect in this completed partial slice:

- [ ] Merge and required CI on #1165 (pending; not claimable from this document).
- [ ] Vertical cutover commits credentials, capability, link removal, audit, and session epochs in one transaction.
- [ ] Self-service independence path, tests, and guards are removed, not left dual-writable.
- [ ] Changed lines within 600–900 and ≤1,000 (hard stop).
- [ ] Shared validator owns self/cycle/age/phone/reachability invariants with database defense.
- [ ] Atomic reassignment with documented lock order, stale conflict, audit, epoch revocation, and post-commit notification.
- [ ] Non-disclosing safe stop replaces self-service linking.
- [ ] Account-first adult account with exactly one persisted `REPRESENTANTE`, legal consents, and verification outbox; empty capability state without membership/link.
- [ ] Session-derived child enrollment with idempotency, non-disclosing safe stop, and atomic conservation.
- [ ] #1138 prohibited write fields rejected before any mutation.
- [ ] Backend `ACTIVA` predicate across members/schedule/attendance; representative-as-player without `ALUMNO`.
- [ ] Empty representative dashboard from server capability; BFF rejects browser-selected subjects.
- [ ] Derived emergency-contact display; minor prohibited form inputs removed; legacy values never shown operationally.
- [ ] Remediation gate with conservation proof; no production execution in this change.
- [ ] Full cross-flow E2E across all seven slices' behaviors.
- [ ] #1135 remains explicitly work-free.
- [ ] Maintain the draft/no-merge tracker #1164; chain each child to its immediate predecessor with the dependency diagram marking the current PR `📍`; keep each child diff limited to its stated work unit.
- [ ] Preserve `proposal.md`, `design.md`, and all `specs/**/spec.md`; update only SDD evidence/status artifacts when implementation results require it. This replan (7 PRs; 600–900 target; 1,000 hard stop) supersedes the earlier 14-PR/400-line plan and the monolithic-slice size exception.
- [ ] Before each PR delivery, verify the exact focused command, runtime scenario, additions+deletions (600–900 target, 1,000 stop), rollback boundary, and skipped CI gates; run one applicable `make pre-pr LANE=backend|frontend|full` lane.
- [ ] After the chain completes, compare implementation against every Given/When/Then scenario and authorization invariant, then record verification evidence before archive.
- [ ] Keep #1135 explicitly superseded with no runtime, migration, relationship, or closure work; close #1132, #1133, #1134, #1138, and #1137 only against their stated completion conditions.
- [ ] Archive the completed OpenSpec change only after all child PRs, migration checks, QA/live scenarios, conservation evidence, and post-merge lifecycle gates pass; do not claim production remediation execution.

## Severe findings

No PR 2 severe implementation or validation finding remains. Archive remains blocked solely by the explicitly listed out-of-scope unchecked work and required PR 1 merge/CI lifecycle gate.

---

## Independent verification — PR3a inert independence-service core

### Result Contract

**PR3a verdict: PASS (inert core slice only).** The overall OpenSpec change remains **BLOCKED for archive**: all PR 3 implementation checkboxes intentionally remain unchecked pending PR3b and later chain/lifecycle work.

- Status/action context: `represented-person-account-flow`, native verify `ready`; `repo-local` worktree is the allowed root.
- Boundary: exactly the new relationship service, its new service-level test file, and PR3a apply-progress evidence changed from base `8c77c5f6eb8e958ba4cfb76cbb1bd9c075f7063b`.
- Inertness: no runtime importer exists outside the candidate test; no router, DTO, `PersonaServicio`, guard, or legacy-route file changed. The administrator router/DTO guard remains explicitly PR3b scope.
- Tests use local `_ComandoIndependencia` dataclass and contain no router/DTO/TestClient/client-fixture import.

### Exact validation

| Gate | Exact command | Result |
|---|---|---|
| Focused PostgreSQL | `cd backend && TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test uv run pytest tests/test_independencia_representada.py -q` | PASS — `25 passed, 1 warning in 7.99s` |
| Legacy + guards | `cd backend && TEST_DATABASE_URL=… uv run pytest tests/test_independizar.py tests/test_bloqueo_del_event_loop.py tests/test_guardia_autorizacion_rutas.py -q` | PASS — `27 passed, 1 warning in 9.48s` |
| Combined | `cd backend && TEST_DATABASE_URL=… uv run pytest tests/test_independencia_representada.py tests/test_independizar.py tests/test_bloqueo_del_event_loop.py tests/test_guardia_autorizacion_rutas.py -q` | PASS — `52 passed, 1 warning in 16.74s` |
| Focused quality | `cd backend && uv run ruff check app/servicios_negocio/relacion_representacion_servicio.py tests/test_independencia_representada.py` | PASS — `All checks passed!` |
| Imports/whitespace/diff | AST import-boundary probe; `git diff --check 8c77c5f6…`; two `git diff --no-index --check /dev/null <new-file>` probes | PASS — clean; service imports without presentation/`PersonaServicio`/`AdminCuentaServicio` and tests without presentation/TestClient |
| Canonical lane | `JWT_SECRET_KEY=… TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test make pre-pr LANE=backend` | PASS — Ruff; import-linter `3 kept, 0 broken`; pip-audit clean; backend `2507 passed, 3 skipped, 85 warnings in 961.55s`; root `582 passed, 1 skipped in 23.86s` |

Skipped locally: CI `migraciones-desde-cero` isolated-empty-PostgreSQL job, as the canonical lane reports. No endpoint/runtime scenario applies because this service is unreferenced.

### Strict TDD and assertion quality

`apply-progress.md` contains PR3a RED/GREEN/TRIANGULATE/REFACTOR evidence. The RED module-absence evidence, final 25-test file, and current GREEN execution were cross-checked. All 25 tests are PostgreSQL service/ORM integration tests; the direct-SQL minor trigger, locks, rollback, replay, audit, epochs, and post-commit notification cases provide triangulation. No tautology, ghost loop, type-only-only, smoke-only, CSS-detail, or client-fixture assertion was found.

### Inventory, workload, and rollback

- `backend/app/servicios_negocio/relacion_representacion_servicio.py` — NEW, 270 additions, SHA-256 `63c693dc40f4463fbe14c874675324b58955867349264356115e050492eb04c7`.
- `backend/tests/test_independencia_representada.py` — NEW, 627 additions, SHA-256 `4c23f7610ce41e82950d4b2ac63aaca54bc60b0af68e105888d32c2eecd286b2`.
- `openspec/changes/represented-person-account-flow/apply-progress.md` — modified, 37 additions; this report section is verification evidence only.
- Native candidate accounting after this section: **983 additions, 0 deletions**, within the PR 3 hard stop of 1,000 (service + tests + SDD evidence).
- PR 3 task state is unchanged: `Vertical cutover…`, `Self-service independence…`, and `Changed lines within 600–900 and ≤1,000…` remain unchecked. This is a CRITICAL archive blocker for the overall change, not a failure of this approved partial slice.
- Rollback: delete only the two NEW PR3a files against PR 2; no router, DTO, legacy route, migration, or production behavior is engaged.

### Severe findings

None for the authorized inert PR3a boundary. Do not archive or mark PR 3 tasks complete until PR3b completes the routed/guarded cutover and the remaining chain gates pass.
