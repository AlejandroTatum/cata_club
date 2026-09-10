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
