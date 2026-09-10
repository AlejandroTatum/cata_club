# Implementation Tasks — Represented-person account flow

> Replan: the original 14-child-PR/400-line plan is superseded by **7
> implementation PRs** with a 600–900 changed-line target and a hard stop at
> 1,000 per PR. The earlier size exception granted to the monolithic
> independence slice (~1,795 changed lines) is superseded by this replan; that
> local slice is not publishable whole and is salvaged into PRs 2–3. See
> `handoff.md` for next-session startup and salvage instructions.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 600–900 target per implementation PR; hard stop 1,000 per PR |
| Review budget | 600–900 target; 1,000 hard stop; no routine size exceptions |
| Budget risk | Managed by this replan; an over-budget slice stops and is re-sliced |
| Chained PRs recommended | Yes |
| Suggested split | Tracker #1164 → PR 1 (#1165, open) → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7 |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |
| Expected PR count | 1 draft/no-merge tracker (#1164) + 7 implementation PRs; PR 1 is open as #1165 and 6 remain |
| Highest-risk slices | PR 3 independence cutover, PR 4 relationship integrity/reassignment, PR 5 atomic enrollment, PR 7 remediation |
| Cumulative estimate | ≈3,600–5,400 changed lines for PRs 2–7 plus the shipped PR 1 |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
Review budget: 600–900 target per implementation PR; hard stop at 1,000 changed lines

Estimates are one honest slicing pass. Do not compress code, tests, migrations,
or documentation to fit a number. If a cohesive slice cannot land at or below
1,000 changed lines, stop and re-slice it; a size exception is not routine and
requires a new explicit human decision.

## Governing inputs and ownership

- Implement against `openspec/changes/represented-person-account-flow/proposal.md`, `design.md`, and every specification under `openspec/changes/represented-person-account-flow/specs/`.
- Preserve the safety order: safe independence before removing represented credentials; invalid entry-path closure and invariants before integration; incompatible-account remediation last.
- **#1137 owns** the complete flow, safety order, authenticated enrollment/payment conservation, remediation gates, and final integration.
- **#1132 owns** active-player truth across membership, roster, scheduling, attendance, and frontend projections.
- **#1133 owns** relationship lifecycle, unified validation, database safeguards, audit, reassignment, revocation, and notification effects.
- **#1134 owns** account-first representative capability and empty dashboard; it does not own independence.
- **#1135 owns no work**: do not add runtime behavior, migration, relationship state, or closure work for it.
- **#1138 owns** minor prohibited fields and representative-derived emergency contact; it does not own legacy-account cleanup.

## Chain map and rollback rule

```text
main
  └─ draft tracker #1164: #1137 represented-person-account-flow
       └─ PR 1  audit/idempotency foundation — open as #1165
            └─ PR 2  existing-person credential + REPRESENTANTE capability primitives
                 └─ PR 3  administrator independence vertical cutover
                      └─ PR 4  relationship integrity and admin reassignment
                           └─ PR 5  account-first representative + represented-minor enrollment
                                └─ PR 6  ACTIVA player truth and frontend experience
                                     └─ PR 7  legacy remediation and final E2E
```

Every PR targets its immediate predecessor and carries a dependency diagram with the current PR marked `📍`. Rollback is only against that immediate parent. PRs 1–6 must preserve person, relationship, membership, payment, medical, attendance, consent, and audit records; PR 7 does not execute production deletion and rolls back by discarding its evidence/tooling change.

## PR 1 — Audit/idempotency foundation — open (#1165)

**Owner:** #1137 with #1133. **Status:** delivered and open for review as [#1165](https://github.com/AlejandroTatum/cata_club/pull/1165) (`fix/represented-person-audit-foundation`), based on tracker #1164. **Dependency:** tracker only. **Estimate:** shipped; exact counts are recorded in the PR.

- [x] Append-only audit can represent create/reassign/independence/removal and replay keys without changing current authorization or closing an entry path; evidence recorded in #1165.
- [ ] Merge and required CI on #1165 (pending; not claimable from this document).

## PR 2 — Existing-person credential and REPRESENTANTE capability primitives

**Owner:** #1134 capability semantics with #1137; preserves #762 compatibility. **Estimate:** 600–900 changed lines; hard stop 1,000. **Dependency:** PR 1 head. **Source:** salvage only the existing-person credential/capability hunks from the local WIP worktree (`pi-1137`, `fix/represented-person-independence`); that slice is monolithic and not publishable, and its remaining hunks feed PR 3.
**Finish:** a non-committing existing-person credential core and the shared `REPRESENTANTE` capability rule (#762 single-role outcomes) exist with focused tests; no relationship mutation, no new endpoints, and no self-service behavior change yet.
**TDD evidence:** RED failing focused tests for the credential core and capability outcomes; GREEN minimal implementation; TRIANGULATE lock/rollback and #762 role cases; REFACTOR to single core ownership.
**Focused validation:** `cd backend && uv run pytest tests/test_auth.py tests/test_roles.py -q` against `db-test` PostgreSQL.
**Runtime:** N/A (no endpoint or UI surface in this slice); record the justification in the PR.
**Rollback:** revert the extracted core/helpers; no relationship, endpoint, or session behavior changes.

- [x] Existing-person credential core creates/updates one `Usuario` on a locked `persona_id` without emitting tokens or creating a `Persona`.
- [x] Shared capability rule implements #762 outcomes: grant when absent, reuse sole `REPRESENTANTE`, explicit sole-role replacement path, reject legacy multi-role accounts.
- [x] No relationship-column writes; no retired `AdminCuentaServicio` usage; changed lines within 600–900 (stop at 1,000).

## PR 3 — Administrator independence vertical cutover

**Owner:** #1137 using #1133 safeguards. **Estimate:** 600–900 changed lines; hard stop 1,000 — this vertical slice may not exceed it; stop and re-slice instead. **Dependency:** PR 2. **Source:** remaining salvaged hunks from the local WIP.
**Finish:** an authorized in-person administrator independence command (relationship service command, DTO/router, audit/session/notification effects) atomically establishes verified credentials plus sole `REPRESENTANTE` on the unchanged `persona_id`, removes the adult link, revokes affected epochs, and best-effort notifies after commit; debt does not block it, minors cannot be unlinked, and the old self-service independence implementation/tests/guards are retired.
**TDD evidence:** RED failing service/router tests (admin-only access, same-person credentials, verified email, debt bypass, minor rejection, legacy multi-role rejection, idempotent retry, rollback, audit, epoch revocation, post-commit notification failure); GREEN; TRIANGULATE PostgreSQL locks and `persona_id` conservation; REFACTOR remove duplicate relationship/account writes.
**Focused validation:** `cd backend && uv run pytest tests/test_independencia_representada.py tests/test_personas.py -q`.
**Runtime:** `make qa-up`; perform admin independence for an adult with debt and verify login/portal plus preserved records; then attempt the same flow for a minor.
**Rollback:** revert the endpoint/service/core before remediation; transaction rollback retains the original link and all history.

- [x] Vertical cutover commits credentials, capability, link removal, audit, and session epochs in one transaction.
- [x] Self-service independence path, tests, and guards are removed, not left dual-writable.
- [x] Changed lines within 600–900 and ≤1,000 (hard stop).

## PR 4 — Relationship integrity and admin reassignment

**Owner:** #1133. **Estimate:** 600–900 changed lines; hard stop 1,000. **Dependency:** PR 3.
**Finish:** `RelacionRepresentacionServicio` owns unified create/reassign validation; the additive migration enforces self/cycle/age/phone database safeguards; administrator reassignment atomically replaces the relationship with audit/revocation/notification; legacy self-service linking returns one non-disclosing safe stop; only current `Persona.representante_id` authorizes access.
**TDD evidence:** RED failing tests for shared invariants, direct-SQL/concurrent graph scenarios, safe-stop non-disclosure, stale reassignment conflict, atomic audit, epoch revocation, and notification failure; GREEN; TRIANGULATE migration/trigger and concurrency cases; REFACTOR remove duplicate validators.
**Focused validation:** `cd backend && uv run pytest tests/test_representacion_triggers.py tests/test_representados_alcanzables.py tests/test_relacion_representacion_servicio.py tests/test_reasignacion_representacion.py tests/test_notificaciones_relacion.py -q`.
**Runtime:** `make qa-up`; submit ambiguous/existing/forged self-service requests (identical safe stops, no mutation); reassign a minor between two valid representatives and verify old-session denial plus current-contact change; then simulate notification failure.
**Rollback:** revert service/router behavior; revert the additive trigger migration only before a later slice depends on it; never delete audit history.

- [ ] Shared validator owns self/cycle/age/phone/reachability invariants with database defense.
- [ ] Atomic reassignment with documented lock order, stale conflict, audit, epoch revocation, and post-commit notification.
- [ ] Non-disclosing safe stop replaces self-service linking.

## PR 5 — Account-first representative and represented-minor enrollment

**Owner:** #1134 with #1137; #1138 write-field rules. **Estimate:** 600–900 changed lines; hard stop 1,000. **Dependency:** PR 4.
**Finish:** rate-limited account-first adult registration (account/verification/empty capability state, no membership/link/token) and authenticated session-derived represented-minor enrollment exist; no child `Usuario`/`ALUMNO`; one atomic commit records Persona + relationship + medical + consents + `INACTIVA` membership + `PENDIENTE` payment; prohibited #1138 minor write fields are explicitly rejected.
**TDD evidence:** RED failing API/service tests for adult-only DTOs, idempotency replay/conflict, verification boundary, consent/outbox atomicity, session authority, safe identity reuse/non-disclosure, prohibited-field rejection, and atomic rollback; GREEN; TRIANGULATE payment/consent/audit failure rollback and DTO matrix cells; REFACTOR remove the public child enrollment branch.
**Focused validation:** `cd backend && uv run pytest tests/test_representante_cuenta.py tests/test_representado_enrollment.py tests/test_enrollment_idempotencia.py tests/test_minor_contact_contract.py -q`.
**Runtime:** `make qa-up`; register an adult, verify email, confirm the empty capability state; enroll a represented minor from an authenticated representative, replay the same key, submit forged actor/credential fields, and inspect persisted rows.
**Rollback:** revert the new contracts; failed transactions leave zero new domain rows; existing adult self-enrollment preserved.

- [ ] Account-first adult account with exactly one persisted `REPRESENTANTE`, legal consents, and verification outbox; empty capability state without membership/link.
- [ ] Session-derived child enrollment with idempotency, non-disclosing safe stop, and atomic conservation.
- [ ] #1138 prohibited write fields rejected before any mutation.

## PR 6 — ACTIVA player truth and frontend experience

**Owner:** #1132 with #1134 (empty dashboard) and #1138 (derived emergency contact). **Estimate:** 600–900 changed lines; hard stop 1,000. **Dependency:** PR 5.
**Finish:** `Membresia.estado == ACTIVA` is the sole player predicate across roster, schedules, and attendance; a `REPRESENTANTE` may play without `ALUMNO`; member/dashboard/portal and BFF consume authoritative membership/player fields; the empty representative dashboard and derived emergency-contact display work end to end, with prohibited minor form fields removed.
**TDD evidence:** RED failing backend predicate tests and frontend Vitest/Playwright projections (active/inactive/representative-only/forged-person); GREEN; TRIANGULATE payment rejection preserving portal access and role/link mismatches; REFACTOR one `isActivePlayer` mapping and centralized minor-form omissions.
**Focused validation:** `cd backend && uv run pytest tests/test_jugador_activo.py tests/test_membresia_repositorio.py tests/test_asistencias.py tests/test_horario_repositorio.py -q && cd ../frontend && pnpm vitest run src/lib/server/__tests__ src/app/student/__tests__`.
**Runtime:** `make qa-up && make qa-live` with active, inactive, representative-only, and forged-person scenarios across members/schedule/attendance/dashboard/forms.
**Rollback:** revert frontend adapters/routes/types and backend predicate consumers while preserving memberships and historical attendance.

- [ ] Backend `ACTIVA` predicate across members/schedule/attendance; representative-as-player without `ALUMNO`.
- [ ] Empty representative dashboard from server capability; BFF rejects browser-selected subjects.
- [ ] Derived emergency-contact display; minor prohibited form inputs removed; legacy values never shown operationally.

## PR 7 — Legacy account remediation and final E2E

**Owner:** #1137. **Estimate:** 600–900 changed lines; hard stop 1,000. **Dependency:** PR 6.
**Finish:** read-only inventory, signed evidence, QA/staging rehearsal, restoration/revocation/conservation checks, candidate fingerprint drift detection, idempotent receipts, and a stop-before-delete gate exist; full cross-flow E2E and cleanup pass; production remediation is not executed.
**TDD evidence:** RED failing gate/conservation tests (missing/changed inventory, failed rehearsal/restoration/revocation/conservation, active-minor reachability, retry receipts, retired-email non-reservation); GREEN; TRIANGULATE rehearsal against QA data and hash conservation; REFACTOR keep remediation isolated from normal account flows.
**Focused validation:** `cd backend && uv run pytest ../tests/test_remediacion_representada.py tests/test_remediacion_inventario.py -q`; the final PR also runs `make pre-pr LANE=full` and the affected Playwright cross-flow specs.
**Runtime:** run the exact inventory/rehearsal against QA data, mutate one candidate between approval and execution, and verify the gate stops before credential/role writes; execute the full cross-flow E2E.
**Rollback:** remove script/runbook/gate and tests; future account restoration uses the protected backup and batch receipts, never deletion of conserved records.

- [ ] Remediation gate with conservation proof; no production execution in this change.
- [ ] Full cross-flow E2E across all seven slices' behaviors.
- [ ] #1135 remains explicitly work-free.

## Parent-owned SDD and delivery housekeeping

These tasks do not add feature behavior and must remain separate from child implementation PRs.

- [ ] Maintain the draft/no-merge tracker #1164; chain each child to its immediate predecessor with the dependency diagram marking the current PR `📍`; keep each child diff limited to its stated work unit.
- [ ] Preserve `proposal.md`, `design.md`, and all `specs/**/spec.md`; update only SDD evidence/status artifacts when implementation results require it. This replan (7 PRs; 600–900 target; 1,000 hard stop) supersedes the earlier 14-PR/400-line plan and the monolithic-slice size exception.
- [ ] Before each PR delivery, verify the exact focused command, runtime scenario, additions+deletions (600–900 target, 1,000 stop), rollback boundary, and skipped CI gates; run one applicable `make pre-pr LANE=backend|frontend|full` lane.
- [ ] After the chain completes, compare implementation against every Given/When/Then scenario and authorization invariant, then record verification evidence before archive.
- [ ] Keep #1135 explicitly superseded with no runtime, migration, relationship, or closure work; close #1132, #1133, #1134, #1138, and #1137 only against their stated completion conditions.
- [ ] Archive the completed OpenSpec change only after all child PRs, migration checks, QA/live scenarios, conservation evidence, and post-merge lifecycle gates pass; do not claim production remediation execution.

## Apply guardrails

- Strict TDD evidence is mandatory for every PR: RED failing test, GREEN minimal implementation, TRIANGULATE adversarial/integration evidence, and REFACTOR architecture/quality evidence.
- Execution is automatic slice by slice: implement/TDD → focused validation → independent verification → native review when applicable → commit/push/open chained PR. Do not ask routine workflow questions between slices.
- Stop conditions: genuine product ambiguity, destructive production action, a failed required gate, a severe review finding, conflict/drift with `main` or the chain parent, or a slice exceeding 1,000 changed lines.
- Backend tests use real PostgreSQL through `db-test` (port 5436, single tenant); do not substitute SQLite or run concurrent backend suites.
- The feature chain is not permission to force-push, merge red/pending CI, modify production configuration, or execute destructive remediation.
