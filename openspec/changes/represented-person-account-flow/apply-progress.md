# Apply progress — PR 1

## Structured status consumed

- `changeName`: `represented-person-account-flow`
- `artifactStore`: `openspec`
- `changeRoot`: `openspec/changes/represented-person-account-flow`
- `applyState`: ready; apply dependency ready
- `actionContext.mode`: `repo-local`
- `workspaceRoot` / allowed edit root: `/home/alejo/devwork/apps/cata_club-worktrees/pi-1137`
- Delivery: `auto-chain`, `feature-branch-chain`, PR 1 only.
- Action-context warning: the authoritative full pre-PR lane is backend-green but stops before frontend because `frontend/node_modules/.bin/playwright` is missing; no dependency installation or production action was performed.

## Completed implementation tasks

PR 1 RED, GREEN, TRIANGULATE, and REFACTOR are persisted as checked in `tasks.md` lines 62–65. The implementation is limited to the additive migration/model/repository/tests foundation. `Persona.representante_id`, live relationship authorization, entry-path behavior, and PR 2+ behavior were not changed.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| PR 1 RED | `backend/tests/test_migracion_representante_auditoria.py`, `backend/tests/test_vinculacion_representante.py` | PostgreSQL integration/model/repository | Initial required command failed because the new files were absent; after test creation it failed with `ModuleNotFoundError` for the not-yet-created repository | Written; exact focused command returned exit 2 | — | — | — |
| PR 1 GREEN | same | PostgreSQL integration/model/repository | — | Preserved RED | Focused suite: `8 passed, 1 warning` | — | — |
| PR 1 TRIANGULATE | same | PostgreSQL migration/direct SQL | Existing relationship compatibility: `tests/test_vincular_representado.py`: `24 passed, 3 warnings` | — | Focused suite: `8 passed, 1 warning` | Empty-to-head, legacy backfill, operation shapes, paired fingerprints, duplicate keys, direct SQL mutation, and append-only rejection covered; `make test-root`: `582 passed, 1 skipped` | — |
| PR 1 REFACTOR | same | PostgreSQL plus repository quality gates | Compatibility regression recorded above | — | Focused suite: `8 passed, 1 warning` | `make test-compose`: `105 passed`; migration/model drift plus focused suite: `9 passed, 1 warning` | Ruff: `All checks passed`; ledger remains separate from authorization and current-state writes |

### Exact commands and results

- `cd backend && uv run pytest tests/test_vinculacion_representante.py tests/test_migracion_representante_auditoria.py -q` before test files existed: `ERROR file or directory not found`, exit 4.
- Same focused command after RED tests: `ModuleNotFoundError: No module named 'app.infraestructura.repositorios.vinculacion_representante_repositorio'`, exit 2.
- Same focused command after GREEN/triangulation/refactor: `8 passed, 1 warning` against PostgreSQL `db-test` on port 5436.
- `TEST_DATABASE_URL=... make test-root`: `582 passed, 1 skipped`.
- `make test-compose`: `105 passed`.
- `uv run ruff check` on all five backend implementation/test files: `All checks passed`.
- `make pre-pr LANE=full`: backend lane completed with `2459 passed, 3 skipped, 85 warnings`; root lane completed with `582 passed, 1 skipped`; frontend lane stopped with `Error: frontend dependencies are missing. Run 'cd frontend && pnpm install' once before this lane.`

## Files changed

- `backend/alembic/versions/h1140rep_auditoria_vinculacion.py` — additive revision after `g1139repmenor`; audit columns, backfill, checks, indexes, idempotency uniqueness, append-only trigger, downgrade boundary.
- `backend/app/dominio/modelos.py` — nullable destination, actor/origin/operation/fingerprint fields, ORM indexes/checks, and legacy writer compatibility defaults; no relationship authorization change.
- `backend/app/infraestructura/repositorios/vinculacion_representante_repositorio.py` — non-committing event registration and keyed replay/conflict handling.
- `backend/tests/test_migracion_representante_auditoria.py` — real PostgreSQL migration/backfill/constraint/direct-SQL coverage.
- `backend/tests/test_vinculacion_representante.py` — model/repository/replay/immutability coverage.
- `openspec/changes/represented-person-account-flow/tasks.md` — only PR 1 implementation checkboxes changed from unchecked to checked.
- `openspec/changes/represented-person-account-flow/apply-progress.md` — this cumulative evidence.

## Review workload and rollback

- Backend work-unit authored count: **393 additions + 5 deletions = 398 changed lines**, within the 400-line budget. SDD bookkeeping files are excluded from this implementation count.
- Boundary: `main → tracker → 📍 PR 1`; migration parent is `g1139repmenor`.
- Rollback: revert the new additive migration/model/repository files before PR 2+ depends on them; downgrade only before dependent later-slice data exists; never delete historical audit rows. No production migration or destructive action was executed.
- Deviations: the existing relationship writer is preserved through ORM compatibility defaults rather than changing service authorization or current-state relationship behavior. The full lane's frontend dependency gap remains an environment blocker for the parent lifecycle.

## Remaining tasks

The following exact unchecked lines remain persisted in `tasks.md`; they are outside PR 1 and were not edited:

```text
- [ ] **RED:** Add failing service/router tests at `backend/tests/test_independencia_representada.py` covering admin-only access, same-person account creation, verified email, debt bypass, minor rejection, legacy multi-role rejection, idempotent retry, rollback, audit, epoch revocation, and post-commit notification failure. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement the no-commit existing-person account core in `backend/app/servicios_negocio/auth_servicio.py`, capability handling in `backend/app/servicios_negocio/rol_servicio.py`, orchestration in new `backend/app/servicios_negocio/relacion_representacion_servicio.py`, and the existing admin route at `backend/app/presentacion/routers/personas_router.py`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Exercise PostgreSQL locks, normalized-email conflicts, `g1139` minor reachability, exact `persona_id` conservation, stale epochs, audit replay, and notification failure after commit; run the focused suite against `db-test` and record results. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Remove duplicate relationship/account writes from `backend/app/servicios_negocio/persona_servicio.py`, preserve one commit/no token behavior, run `make lint-backend` and the focused suite, and record the independence runtime result. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing API/service tests at `backend/tests/test_representante_cuenta.py` for adult-only DTOs, idempotency replay/conflict, email verification boundary, consent/outbox atomicity, exact single role, no membership/link/token, and no `AdminCuentaServicio` call. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add `backend/app/servicios_negocio/cuenta_representante_servicio.py`, shared non-committing account/capability helpers in `backend/app/servicios_negocio/auth_servicio.py` and `rol_servicio.py`, DTOs under `backend/app/servicios_negocio/dtos/`, and route wiring in `backend/app/presentacion/routers/auth_router.py`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test duplicate identity/email, consent/outbox/role failure rollback, #762 single-role trigger, unverified portal denial, verified zero-link access, and dependency injection/rate-limit behavior; run the focused suite plus `make test-root`. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep `REPRESENTANTE` as persisted capability rather than link-count inference, remove obsolete account writer coupling, run `make lint-backend`, and record the QA registration/verification scenario. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing tests at `frontend/src/app/student/__tests__/StudentPage.test.tsx`, `frontend/src/lib/server/__tests__/student-adapter.test.ts`, and the backend student response test for `capabilities.representante=true`, `representados=[]`, no membership/player access, and denied arbitrary-person data. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `frontend/src/app/student/page.tsx`, `frontend/src/lib/server/student-adapter.ts`, `frontend/src/types/domain.ts`, and the backend student/dashboard DTO projection to render the empty state from server capability; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test unverified accounts, former representatives after link removal, forged `personaId`, empty/loading/error states, and direct backend authorization; run the focused Vitest suite and `pnpm exec playwright test` for the affected student route. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep the empty dashboard accessible without membership or links, run `pnpm type-check` and `pnpm lint`, and record the live QA scenario. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing backend tests at `backend/tests/test_jugador_activo.py` and extend `backend/tests/test_membresia_repositorio.py`, `test_asistencias.py`, and `test_horario_repositorio.py` for active-only eligibility, representative-without-`ALUMNO`, inactive exclusion, and duplicate payment outcomes. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add `es_jugador_activo` and `existe_activa_por_persona` in `backend/app/servicios_negocio/membresia_pago_servicio.py` and `backend/app/infraestructura/repositorios/membresia_repositorio.py`; update `backend/app/servicios_negocio/asistencia_servicio.py` and roster/schedule consumers; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test set-based projections, expired/suspended memberships, role-only accounts, historical attendance preservation, and payment approval/rejection boundaries against PostgreSQL; record focused and root-test results. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Remove role-as-player gates and lazy `ALUMNO` assignment from membership creation without changing capability removal, run `make lint-backend`, and record the QA roster scenario. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing Vitest/Playwright tests at `frontend/src/lib/server/__tests__/members-adapter.test.ts`, `frontend/src/lib/server/__tests__/student-adapter.test.ts`, `frontend/src/app/student/__tests__/student-utils.test.ts`, and affected route tests for membership-state projection and forged `personaId`. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `frontend/src/app/api/student/route.ts`, `frontend/src/app/api/members/route.ts`, `frontend/src/lib/server/student-adapter.ts`, `frontend/src/lib/server/members-adapter.ts`, `frontend/src/types/domain.ts`, and dashboard/member/student consumers; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test role/link mismatch, payment rejection preserving portal access, active representative without `ALUMNO`, mocked and live backend responses, and API error pass-through; run focused Vitest and affected Playwright specs. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Consolidate one `isActivePlayer`/membership-state mapping, run `pnpm type-check` and `pnpm lint`, and record the live projection scenario. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing API/service tests at `backend/tests/test_minor_contact_contract.py`, `test_ficha_emergencia.py`, and `test_ficha_medica_representante.py` for omitted versus explicit null/empty/populated prohibited fields, adult emergency requirements, legacy-value omission, and concurrent phone invalidation. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `backend/app/servicios_negocio/dtos/persona_schemas.py`, the ficha-medical DTO/service modules under `backend/app/servicios_negocio/`, `backend/app/servicios_negocio/persona_servicio.py`, and `backend/app/presentacion/routers/ficha_medica_router.py`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test every DTO/BFF matrix cell before mutation, representative phone regex parity with `_RE_TELEFONO_FORMA`, reassignment read-after-commit, and adult-without-representative validation using real PostgreSQL. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep legacy values storage-compatible but operationally unreachable, run `make lint-backend` and the focused suite, and record the derived-contact QA scenario. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing tests at `frontend/src/app/student/add-dependent/__tests__/add-dependent-utils.test.ts`, `frontend/src/app/student/enroll/__tests__/enrollmentPayload.test.ts`, `frontend/src/app/student/medical-record/__tests__/StudentMedicalRecordPage.test.tsx`, and new BFF route tests for explicit prohibited fields. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `frontend/src/app/student/add-dependent/page.tsx`, `add-dependent-utils.ts`, `frontend/src/app/student/enroll/page.tsx`, enrollment types/adapters, `frontend/src/app/api/fichas-medicas/persona/[id]/route.ts`, and `frontend/src/types/domain.ts`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test null/empty/populated forbidden fields, adult emergency controls, current-versus-former representative contact, backend 422 pass-through, and no partial browser state; run focused Vitest and affected Playwright specs. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Centralize minor-form field omission and accessible error/empty states, run `pnpm type-check` and `pnpm lint`, and record the live form scenario. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing direct-SQL/concurrency tests at `backend/tests/test_representacion_triggers.py` and extend `backend/tests/test_representados_alcanzables.py` for all database-boundary scenarios in `representation-lifecycle/spec.md`. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add the next Alembic revision after `g1139repmenor_representados_menores_alcanzables.py`, update `backend/app/dominio/representados_alcanzables.py`, `backend/app/dominio/modelos.py`, and repository lock helpers; make RED pass without adding a second relationship projection. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Run empty-to-head migration, concurrent graph writes with PostgreSQL advisory lock, unrelated aged-in-place adult updates, invalid phone changes with active minors, and existing trigger regression tests; record `make test-root`. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep trigger scope limited to relationship/phone writes and `IS NOT DISTINCT FROM` short-circuiting, run `make test-compose` and `make lint-backend`, and document safe downgrade boundary. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing tests at `backend/tests/test_relacion_representacion_servicio.py`, `test_personas.py`, and `test_politica_acceso.py` for shared invariants, historical-representative denial, safe-stop non-disclosure, no request state, and idempotent validation. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement the shared validator/commands in `backend/app/servicios_negocio/relacion_representacion_servicio.py`, delegate `representante_id` changes from `persona_servicio.py`, and replace `backend/app/presentacion/routers/personas_router.py` legacy linking behavior; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test direct route/backend bypass, self/cycle/age/phone/reachability conflicts, old audit not granting access, syntactic 422 versus safe 409, and rollback with no notification; run focused tests against PostgreSQL. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Remove duplicate validators and preserve live relationship authorization in `backend/app/servicios_negocio/politica_acceso.py`, run import/lint checks, and record the safe-stop runtime result. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing tests at `backend/tests/test_reasignacion_representacion.py` and `test_notificaciones_relacion.py` for admin authorization, identity evidence, lock ordering, stale conflict, atomic audit, epoch revocation, current-contact projection, notification-after-commit, and notification failure. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add the administrator route/schema in `backend/app/presentacion/routers/personas_router.py` (or its established admin router), repository locked reads, audit writes, session epoch updates, and existing `Notificacion` integration; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test concurrent reassignment, equivalent idempotent retry, distinct stale retry, rollback before commit, former representative access, and absence of relationship outbox/request tables; run focused tests and `make test-root`. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep notification work in a separate post-commit transaction with neutral copy/structured failure logging, run `make lint-backend`, and record the QA reassignment scenario. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing backend/API tests at `backend/tests/test_representado_enrollment.py` and extend `test_enrollment_idempotencia.py`/`test_enrollment_servicio.py` for session authority, safe reuse, non-disclosure, prohibited credentials, consent/medical/audit/payment rollback, one inactive membership, and retry behavior. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add the session-derived command to `backend/app/servicios_negocio/relacion_representacion_servicio.py`, DTOs in `backend/app/servicios_negocio/dtos/persona_schemas.py` and enrollment schemas, route `POST /representados` in `backend/app/presentacion/routers/personas_router.py`, and repository transaction helpers; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test forged body/URL/BFF actor, identity races, duplicate pending-payment constraints, every failure rollback, legal-consent linkage, direct backend bypass, and exact response omission of credentials/token; record focused and migration tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Remove the public child branch from `backend/app/servicios_negocio/enrollment_servicio.py` while retaining adult self-enrollment, centralize fingerprints, run `make lint-backend`, and record the authenticated QA scenario. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing backend tests at `backend/tests/test_pago_enrollment_conservation.py` and frontend tests at `frontend/src/lib/server/__tests__/enrollment-adapter.test.ts` plus dependent-flow harness coverage for approval, rejection, duplicate verdict, and response conservation. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `backend/app/servicios_negocio/membresia_pago_servicio.py`, `backend/app/presentacion/routers/membresias_pagos_router.py`, `frontend/src/app/api/representados/route.ts`, `frontend/src/lib/server/enrollment-adapter.ts`, and `frontend/src/app/student/add-dependent/`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Verify no relationship/capability/session removal on rejection, only the linked membership activates on approval, duplicate outcomes are idempotent, server financial snapshots remain authoritative, and live reload reflects state; run focused tests and `make qa-live`. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep payment validation's existing `FOR UPDATE` boundary, remove client-selected financial/actor fields, run `pnpm type-check`, `make lint-backend`, and record exact live results. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing gate/conservation tests at `backend/tests/test_remediacion_inventario.py`, `../tests/test_remediacion_representada.py`, and new script tests for missing/changed inventory, failed rehearsal/restoration/revocation/conservation, active-minor reachability, retry receipts, and retired-email non-reservation. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add read-only inventory and rehearsal tooling under `backend/scripts/` (including a focused runbook beside the script), batch evidence/receipt models only if required by the design, and hard-stop checks; make RED pass without production deletion execution. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Rehearse representative QA data, compare people/relationships/memberships/payments/medical/attendance/consent/audit hashes, test candidate drift and session epoch proof, and record the exact no-delete result. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep remediation isolated from normal account flows, document restoration and rollback boundaries, run `make test-root`, `make lint-backend`, and the focused command, and attach the rehearsal evidence. <!-- sdd-owner: implementation -->
- [ ] Create and maintain the draft/no-merge tracker PR for `#1137`, chain each child to its immediate predecessor, include the dependency diagram with `📍`, and keep each child diff limited to its stated work unit. <!-- sdd-owner: parent -->
- [ ] Preserve `proposal.md`, `design.md`, and all `specs/**/spec.md`; update only SDD evidence/status artifacts in `openspec/changes/represented-person-account-flow/` when implementation results require it. <!-- sdd-owner: parent -->
- [ ] Before each child delivery, verify the exact focused command, runtime scenario, additions+deletions, rollback boundary, and skipped CI gates; run one applicable `make pre-pr LANE=backend|frontend|full` lane for the child. <!-- sdd-owner: parent -->
- [ ] After the chain is complete, compare implementation against every Given/When/Then scenario and authorization invariant, then record verification evidence in the change artifacts before archive. <!-- sdd-owner: parent -->
- [ ] Keep #1135 explicitly superseded with no runtime, migration, relationship, or closure work; close #1132, #1133, #1134, #1138, and #1137 only against their stated completion conditions. <!-- sdd-owner: parent -->
- [ ] Archive the completed OpenSpec change only after all child PRs, migration checks, QA/live scenarios, conservation evidence, and post-merge lifecycle gates pass; do not claim production remediation execution. <!-- sdd-owner: parent -->
```

## Corrective verification after independent review

- Added a PostgreSQL `BEFORE TRUNCATE` guard to the append-only relationship audit ledger.
- Added ORM metadata parity for allowed `origen` values and lowercase 64-character SHA-256 fingerprints.
- Focused PostgreSQL suite: `11 passed, 1 warning`.
- Migration/ORM parity checks: `2 passed, 1 warning`.
- Ruff and `git diff --check`: passed.
- Independent verifier verdict: PASS; no PR 2+ scope drift.
- Backend candidate count after correction: 474 additions + 5 deletions = 479 changed lines.
- Maintainer accepted `size:exception` for this cohesive PR 1 slice; native complete-candidate accounting remains authoritative.

---

# Apply progress — PR 2 (existing-person credential + REPRESENTANTE capability primitives)

## Structured status consumed

- `changeName`: `represented-person-account-flow`; `artifactStore`: `openspec`; `applyState`: ready.
- `actionContext.mode`: `repo-local`; allowed edit root: this worktree (`pi-1137-pr2`, branch `fix/represented-person-credentials` based on PR 1 head `4a60ca2`).
- Delivery: `auto-chain`, `feature-branch-chain`; PR 2 targets immediate predecessor `fix/represented-person-audit-foundation` (#1165); parent owns commit/push/PR/attempt settlement (no sdd-attempt calls made).
- Boundary honored: no relationship-column writes, no endpoint/router changes, no self-service independence behavior, no `AdminCuentaServicio` usage, no PR 3 hunks; salvage from `pi-1137` WIP was read-only (only the two auth/role hunks adapted).

## Completed implementation tasks (persisted in `tasks.md`)

- `[x]` Existing-person credential core creates/updates one `Usuario` on a locked `persona_id` without emitting tokens or creating a `Persona`.
- `[x]` Shared capability rule implements #762 outcomes: grant when absent, reuse sole `REPRESENTANTE`, explicit sole-role replacement path, reject legacy multi-role accounts.
- `[ ]` Third PR 2 checkbox (boundary/budget bundle) left unchecked per parent instruction; its guards are evidenced below and the diff is final for apply scope.

## TDD Cycle Evidence (strict TDD)

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| Credential core | `backend/tests/test_auth.py` | PostgreSQL service/ORM | — | 5 failed: `AttributeError: ...establecer_credenciales_persona_existente` | 5 passed | +3 adversarial (whitespace-normalized foreign-email conflict, no epoch bump, caller-owns-commit persistence) → 8 passed | ruff clean; reuses `obtener_por_correo`/`obtener_hash_contrasenia`; no `.commit()`, no tokens, no `AdminCuentaServicio` in code |
| Capability rule | `backend/tests/test_roles.py` | PostgreSQL service + real #762 trigger | — | 8 failed: `AttributeError: ...establecer_capacidad_representante` | 8 passed | +4 adversarial (caller-owns-commit, no epoch bump, catalog row preserved on replacement, same association row on reuse) → 12 passed | ruff clean; single core ownership (no `exigir_rol_unico` duplication: reject vs. deterministic establishment are distinct contracts by design) |

### Exact commands and results (runner: `uv run pytest` against real `db-test` PostgreSQL, port 5436)

- RED: `TEST_DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test JWT_SECRET_KEY=... uv run pytest tests/test_auth.py tests/test_roles.py -q` → **13 failed, 1 warning in 2.08s** (exit 1; all `AttributeError` for the two missing methods).
- GREEN: same command → **13 passed, 1 warning in 5.33s** (one iteration: the foreign-email test initially verified a password against a plain string instead of a real legacy hash; fixed the seed, not the production code).
- TRIANGULATE: same command → **20 passed, 1 warning in 6.71s**.
- REFACTOR: same command → **20 passed, 1 warning** (final); `uv run ruff check` on the four touched backend files → **All checks passed**.
- Safety net: `uv run pytest tests/test_rol_unico_por_cuenta.py tests/test_auth_registro_refresh.py tests/test_autenticacion_endpoints.py tests/test_admin_cuenta_servicio.py tests/test_auth.py tests/test_roles.py -q` → **92 passed, 1 warning in 15.17s** (includes the #762 rejection regressions and the retired-module import compatibility suite).
- Import/attribute probe (`AMBIENTE=test`): cores exist; method sources contain no `AdminCuentaServicio`, no token creation, no `.commit()`; `git diff | grep -ci admincuentaservicio` → 0.

## Files changed

- `backend/app/servicios_negocio/auth_servicio.py` — new non-committing `AuthServicio.establecer_credenciales_persona_existente(persona, correo, contrasenia) -> Usuario`: creates or updates exactly one `Usuario` on the received (caller-locked) `persona_id` with `correo_verificado=True`; normalized-email uniqueness against other persons' accounts (`EntidadDuplicada`, same `lower(btrim)` predicate as `ix_usuario_correo_lower`); flush-only; no token, no `Persona`, no role, no relationship write. `Persona` added to the existing model import.
- `backend/app/servicios_negocio/rol_servicio.py` — new shared `RolServicio.establecer_capacidad_representante(usuario) -> bool`: #762 outcomes (reject legacy multi-role with `OperacionInvalida` before any flush; reuse sole `REPRESENTANTE` → False; explicit sole-role replacement with DELETE flushed before INSERT so the real `trg_usuario_rol_unico_por_usuario` admits the pair; grant when absent, never `ALUMNO`); flush-only; never touches `version_sesion` or relationship columns.
- `backend/tests/test_auth.py` (new) — 8 tests: single-account creation on existing persona, rollback discipline (commit guard + rollback discards), legacy update in place, own-email reuse, foreign-email rejection without mutation, whitespace/case variant conflict parity, no epoch bump, caller-commits persistence.
- `backend/tests/test_roles.py` (new) — 12 tests: grant/reuse/replacement (parametrized over ADMINISTRADOR/ENTRENADOR/ALUMNO)/multi-role rejection, no `ALUMNO` and no link write, rollback discipline, caller-commits, no epoch bump, catalog preservation, association identity on reuse.
- `openspec/changes/represented-person-account-flow/tasks.md` — only the two PR 2 implementation checkboxes changed to `[x]`.
- `openspec/changes/represented-person-account-flow/apply-progress.md` — this cumulative evidence (PR 1 content preserved).

## Review workload, rollback, deviations

- Authored count: 109 additions + 1 deletion (tracked) + 528 additions (two new test files) = **638 changed lines** — inside the 600–900 target, under the 1,000 hard stop. SDD bookkeeping files excluded from the implementation count.
- Runtime harness: N/A — no endpoint or UI surface in this slice (justification recorded here for the PR body per `tasks.md`).
- Rollback boundary: revert the two new methods plus the two new test files; no migration, no router, no relationship/session behavior, and no other slice's code is touched, so rollback removes nothing else.
- Deviations from design/salvage: none material — hunks adapted verbatim from the WIP salvage except comments updated to describe the shared (not independence-specific) role; epoch bumping and audit/idempotency stay with the PR 3 command by design, and tests pin the cores to NOT do them.
- Skipped locally: full `make pre-pr` lane not run (parent owns PR delivery per instruction); frontend lane not applicable (no frontend change); CI gates cannot be claimed locally.

## Remaining tasks (exact unchecked lines owned by this change)

```text
- [ ] Merge and required CI on #1165 (pending; not claimable from this document).
- [ ] No relationship-column writes; no retired `AdminCuentaServicio` usage; changed lines within 600–900 (stop at 1,000).
- [ ] Vertical cutover commits credentials, capability, link removal, audit, and session epochs in one transaction.
```

(plus all PR 3–7 and parent-owned lines, unchanged — see `tasks.md`.)

---

# Apply progress — PR3a (inert independence command service + its focused tests; attempt 2 completes the interrupted writer)

## Structured status consumed

- `changeName`: `represented-person-account-flow`; `artifactStore`: `openspec`; `applyState`: ready.
- `actionContext.mode`: `repo-local`; allowed edit roots: this worktree (`pi-1137-pr3a`, branch `fix/represented-person-independence-core`, base PR 2 head `8c77c5f`).
- Delivery: `auto-chain`, `feature-branch-chain`; parent owns attempt settlement; no attempt commands called; no commit/push/PR performed.
- Slice: the parent-authorized PR3a split preserved in the oracle (`pi-1137-pr3`): service verbatim + service-level tests only; PR3b owns router/DTO cutover, self-service retirement, endpoint/runtime/DTO tests, and the two granted 1-line guard hunks.

## Files changed (both NEW/untracked on base `8c77c5f`)

- `backend/app/servicios_negocio/relacion_representacion_servicio.py` — 270 lines, byte-identical to the oracle candidate (`diff` verified). Inert: no router imports it; `independizar_presencial` only (no `crear_desde_sesion`/`reasignar_presencial` anticipated).
- `backend/tests/test_independencia_representada.py` — 627 lines, 25 tests. Authorized adaptation of oracle lines 1–619: local `@dataclass _ComandoIndependencia(correo, contrasenia, evidencia_identidad)` replaces the `IndependizarDTO` import (the service duck-types `.correo`/`.contrasenia`); no router/DTO/client usage (one docstring mention only). Excludes oracle lines 620–748 (PR3b sections).
- `openspec/changes/represented-person-account-flow/apply-progress.md` — this section only. `tasks.md` NOT modified (split checkbox policy: PR 3 checkboxes wait for PR3b).

## TDD cycle evidence (strict TDD; runner `uv run pytest` against real `db-test` PostgreSQL :5436)

| Phase | Command (cd backend; TEST_DATABASE_URL + JWT_SECRET_KEY set) | Result |
|---|---|---|
| RED | service file moved to `/tmp` outside import resolution; focused suite run | `ModuleNotFoundError: No module named 'app.servicios_negocio.relacion_representacion_servicio'`; 1 collection error, exit 2; file restored immediately, SHA-256 identical before/after |
| GREEN | `uv run pytest tests/test_independencia_representada.py -q` | `25 passed, 1 warning in 8.41s` (final bytes) |
| TRIANGULATE | `uv run pytest tests/test_independizar.py tests/test_bloqueo_del_event_loop.py tests/test_guardia_autorizacion_rutas.py -q` | `27 passed, 1 warning in 9.52s` — legacy self-service suite + both guard files green UNTOUCHED (verified zero diffs vs base) |
| Combined | focused + safety net in one run | `52 passed, 1 warning in 16.70s` |
| REFACTOR | `uv run ruff check` (both files); import probe (`AMBIENTE=test`); `git diff --no-index --check /dev/null <file>` ×2 | `All checks passed!`; clean import; 0 `AdminCuentaServicio`; 0 router/DTO imports; zero whitespace findings |

REFACTOR correction: the prior writer left a trailing blank line at EOF in the test file (`git diff --check`: `new blank line at EOF`; the oracle candidate is clean). Corrected to a single trailing newline (628→627 lines; 1-byte, behavior-neutral); GREEN/TRIANGULATE/REFACTOR numbers were re-captured on the final bytes.

## Workload, rollback, remaining

- Count: 897 implementation additions (270 + 627), 0 deletions — inside the 600–900 target; ≤1,000 hard stop respected including this bookkeeping section (exact final total below).
- Rollback boundary: delete the two new files; nothing else exists to revert; no migration; no route/behavior change anywhere (the service has zero importers).
- Runtime: N/A — no endpoint or UI surface in this slice (record this justification in the PR body).
- Skipped by parent instruction: full `make pre-pr` lane (the independent verifier owns it); CI gates are not claimable locally.
- Evidence SHA-256 (final): service `63c693dc40f4463fbe14c874675324b58955867349264356115e050492eb04c7`; tests `4c23f7610ce41e82950d4b2ac63aaca54bc60b0af68e105888d32c2eecd286b2`.

---

# Apply progress — PR3b (vertical cutover: router/DTO wiring, self-service retirement, guard updates)

## Structured status consumed

- `changeName`: `represented-person-account-flow`; `artifactStore`: `openspec`; `applyState`: ready.
- `actionContext.mode`: `repo-local`; allowed edit root: this worktree (`pi-1137-pr3b`), base = green PR3a commit `87518b2` (verified as HEAD).
- Delivery: `auto-chain`, `feature-branch-chain`; PR3b is the second half of the authorized PR3 re-slice (PR3a service core + PR3b cutover). Parent owns attempt settlement; **no attempt commands, no commit, no push, no PR created**. Oracle `/home/alejo/devwork/apps/cata_club-worktrees/pi-1137-pr3` used read-only; every production/test file touched is byte-identical to the oracle candidate.
- Slice boundary honored: no PR4 validator/reassignment work; `RelacionRepresentacionServicio` remains `independizar_presencial`-only; no production execution; specs/proposal/design untouched.

## Authorized re-slice recorded

PR 3 was re-sliced (authorized by parent) into **PR3a** (inert `RelacionRepresentacionServicio.independizar_presencial` core + 25 service-level tests, landed as `87518b2`) and **PR3b** (this slice: router/DTO cutover, `PersonaServicio.independizar` retirement, legacy self-service test deletion, two 1-line guard updates, 8 appended runtime/idempotency/endpoint/DTO tests). Each half is inside the 600–900 target on its own; the full native PR3b diff vs `87518b2` is **190 additions + 516 deletions = 706 changed lines** (inside 600–900; ≤1,000 hard stop respected), dominated by the 415-line legacy self-service suite deletion.

## Files changed (native diff vs `87518b2`)

- `backend/app/presentacion/routers/personas_router.py` (+31/−23): route `POST /personas/{persona_id}/independizar` now `GestorPermisos(["ADMINISTRADOR"])` (was any-authenticated + `exigir_acceso_directo`), `response_model=IndependenciaResponseDTO` (never tokens), `Request` injected, `run_in_threadpool` calls `RelacionRepresentacionServicio(db).independizar_presencial(admin_actor_id, persona_id, comando, idempotency_key=request.headers.get("idempotency-key"))`; comments updated.
- `backend/app/servicios_negocio/dtos/persona_schemas.py` (+22/−3): `IndependizarDTO` becomes the presential command (normalized `CorreoValidado`, `ContraseniaValidada`, required `evidencia_identidad` 1–500); new `IndependenciaResponseDTO` (persona_id, representante_anterior_id, usuario_id, cuenta_creada, replay, idempotency_key; deliberately no tokens).
- `backend/app/servicios_negocio/persona_servicio.py` (+1/−60): retired `PersonaServicio.independizar` (self-service: password confirm + debt block + bare link cut) plus `MembresiaRepositorio`/`IndependizarDTO` imports; zero dual-write paths remain.
- `backend/tests/test_independencia_representada.py` (627→748 lines, +134/−13): restored `IndependizarDTO` import, removed the local `_ComandoIndependencia` dataclass, appended oracle lines 619–748: real login runtime test, required idempotency-key service test, 5 endpoint tests (403 non-admin, 200 admin full-body sans tokens, 400 missing key, 400 minor with link intact, 404 unknown persona), DTO validation matrix. Byte-identical to the oracle candidate (SHA `06256c6f…286b2`).
- `backend/tests/test_guardia_autorizacion_rutas.py` (+1/−1): the route guard map moves `/personas/{persona_id}/independizar` from the any-authenticated bucket `(b)` to `frozenset({"ADMINISTRADOR"})`.
- `backend/tests/test_bloqueo_del_event_loop.py` (+1/−1): event-loop CPU guard retargets from retired `PersonaServicio.independizar` to `RelacionRepresentacionServicio.independizar_presencial` (bcrypt hashing must stay off the loop).
- `backend/tests/test_independizar.py` (−415, deleted): the legacy self-service independence suite; no dual-write surface left.
- `openspec/changes/represented-person-account-flow/tasks.md`: exactly the three PR3 summary checkboxes marked `[x]`.
- `openspec/changes/represented-person-account-flow/apply-progress.md`: this section only.

## TDD cycle evidence (strict TDD; runner `uv run pytest` against real `db-test` PostgreSQL :5436)

| Phase | Command (cd backend; TEST_DATABASE_URL + JWT_SECRET_KEY set) | Result |
|---|---|---|
| RED | Test file extended to the oracle 748-line candidate first (byte-identical, SHA `06256c6f…`), production untouched; focused subset run: `-k "runtime or idempotencia or endpoint or dto"` | **4 failed, 4 passed** in 1.85s: `test_runtime_el_adulto_puede_loguearse…`, `test_endpoint_admin_completa…`, `test_endpoint_sin_clave…` (route accepted any auth + returned no command DTO), `test_dto_exige…` (`'IndependizarDTO' object has no attribute 'correo'`) — exit 1 |
| GREEN | Copied oracle bytes: router, DTOs, persona_servicio retirement; deleted `tests/test_independizar.py`; applied the two 1-line guard hunks; full suite `uv run pytest tests/test_independencia_representada.py -q` | **33 passed, 1 warning in 9.83s** (25 service-level + 8 runtime/idempotency/endpoint/DTO) |
| TRIANGULATE | `tests/test_independencia_representada.py tests/test_guardia_autorizacion_rutas.py tests/test_bloqueo_del_event_loop.py tests/test_contrasenia_validada.py tests/test_migracion_representados_alcanzables.py tests/test_representante_no_deja_menores_huerfanos.py tests/test_personas.py -q` | **129 passed, 11 warnings in 31.25s** |
| TRIANGULATE (safety net) | PR2 cores + audit/role/link suites: `test_auth.py test_roles.py test_rol_unico_por_cuenta.py test_auth_registro_refresh.py test_autenticacion_endpoints.py test_admin_cuenta_servicio.py test_vinculacion_representante.py test_migracion_representante_auditoria.py test_vincular_representado.py -q` | **127 passed, 3 warnings in 22.92s** |
| REFACTOR | `uv run ruff check` on all 6 touched files; import/attribute probe (`AMBIENTE=test`); `git diff --check`; `git diff \| grep -ci admincuentaservicio` | `All checks passed!`; route introspection: `POST /personas/{persona_id}/independizar` deps = `GestorPermisos` only, `response_model=IndependenciaResponseDTO`; `PersonaServicio.independizar` retired (`hasattr` → False); legacy test file gone; zero whitespace findings; 0 `AdminCuentaServicio` references in the diff |

## Runtime status

`make qa-up` + admin-presential independence runtime scenario (adult with debt: login/portal + preserved records; then minor attempt): **PENDING** — per parent instruction, the independent verifier owns full `pre-pr` and QA runtime if apply risks timeout; no runtime claims made by this apply.

## Rollback boundary

Revert exactly this native diff against `87518b2`: the router hunk, DTO hunk, `PersonaServicio.independizar` retirement, the 748-line test file, the two guard hunks, and the deleted `tests/test_independizar.py`. Nothing else (service core, auth/role cores, migrations, other slices) is touched, so rollback removes no unrelated work. The old self-service behavior returns by restoring `test_independizar.py` + the router/service hunks from the parent commit.

## Evidence SHA-256 (final bytes)

- `backend/app/presentacion/routers/personas_router.py` → `37d6348a644d91c3d6576e84157bb7d45a9fd629d6aa62d4992913990aa86fb3`
- `backend/app/servicios_negocio/dtos/persona_schemas.py` → `0b1c68030049fcc2ab22b2c22878c65c13a320e2da22518eb7ac35ca3598ab7c`
- `backend/app/servicios_negocio/persona_servicio.py` → `dd3caf9c6f006b57cbea775f74ee65a8820f8a626914332f45d57064e4cba2d7`
- `backend/tests/test_independencia_representada.py` → `06256c6ffef601a1e27a2c5c14aaacbaa9f647b8041798087869b6f8717ee237` (byte-identical to oracle)
- `backend/tests/test_guardia_autorizacion_rutas.py` → `8952d087b232ef8d937233d3d7fdd5ca9fcad36ab7dd51de3d88459e71d65db8`
- `backend/tests/test_bloqueo_del_event_loop.py` → `d00110d72bcc54d5a20841c080f31cb1b6ae876675852b728012c3067d98537a`

## Workload, skipped gates, deviations

- Native changed lines: **706** (190+ / 516−) — inside the 600–900 target; ≤1,000 hard stop respected including this bookkeeping section.
- Skipped locally (recorded, not claimed): full `make pre-pr` lane and QA runtime are parent/verifier-owned per instruction; remote CI gates are not claimable locally.
- Deviations from the oracle: none — every touched file is byte-identical; the only local composition work is the PR3a/PR3b split itself.
- Next in chain: PR 4 (relationship integrity + admin reassignment). This apply stops before PR4; `#1165` merge/CI and tracker housekeeping remain parent-owned.

---

# Apply progress — PR4a0 (legacy adult-link fixture compatibility; test-only preparatory slice)

## Structured status consumed

- `changeName`: `represented-person-account-flow`; `artifactStore`: `openspec`; `applyState`: ready.
- `actionContext.mode`: `repo-local`; allowed edit root: this worktree (`pi-1137-pr4a0`, branch head `d63e10d`, the clean PR3b predecessor).
- Delivery: `auto-chain`, `feature-branch-chain`; **PR4a0** is the parent-authorized test-only preparative slice of PR 4. Parent owns attempt settlement, commit, push, and PR creation; no attempt commands, no commit, no push, and no production action were performed.
- Boundary honored: **no production code, no migration, no router/service/DTO change, no `openspec/**/spec.md`, `proposal.md`, or `design.md` edit, and no task checkbox change.** `tasks.md` was deliberately left untouched; the three PR 4 implementation checkboxes stay `- [ ]` because PR4a0 completes neither the database slice (PR4a) nor the validator/reassignment/safe-stop slice (PR4b).

## Files changed (test fixtures only)

Seven files carry the tracked fixture corrections already present in the read-only oracle `pi-1137-pr4a` (`+49/-15` there), copied byte-identical except one docstring adaptation noted below:

- `backend/tests/test_baja_logica_persona.py` — `_crear_persona(..., fecha_nacimiento=...)`; the two dependent-link fixtures seed a 2015 minor.
- `backend/tests/test_beneficio_autoservicio.py` — linked child seeded as a 2015 minor.
- `backend/tests/test_inventario_anomalias_membresias.py` — linked member seeded as a 2015 minor.
- `backend/tests/test_notificaciones_paginacion.py` — `_crear_persona(..., fecha_nacimiento=...)`; both dependent feeds seed a 2015 minor.
- `backend/tests/test_migracion_representados_alcanzables.py` — new `_sembrar_persona_legada_mayor_vinculada` helper (minor link, then `UPDATE fecha_nacimiento`), used by the two legacy-adult scenarios. **Adaptation:** the docstring names "el candado de relación de PR 4" instead of the oracle's literal `i1141relinteg` revision id, because that migration is not part of this predecessor; the executable code is byte-identical.
- `backend/tests/test_independencia_representada.py` — `_representado_adulto` seeds a 2020 minor link and ages in place to `2000-06-15`.
- `backend/tests/test_representante_no_deja_menores_huerfanos.py` — the "Carla" majority-of-age control seeds `MENOR_NACIMIENTO` and ages in place to `1995-01-01`.

Five files carry the **remaining failures listed in the oracle's `verify-report.md`**, corrected with the same recipe (no oracle version existed):

- `backend/tests/test_alertas_mora.py` — `_crear_persona` gains `fecha_nacimiento`; linked rows are seeded as a 2015 minor then aged in place.
- `backend/tests/test_alertas_vencimiento.py` — same in `_crear_persona` (covers the `[3]`/`[6]` N+1 cases and the retry case).
- `backend/tests/test_membresia_repositorio.py` — same in `_crear_persona` (family count/DISTINCT case).
- `backend/tests/test_notificaciones_marcar_todas.py` — same in `_crear_persona` (own + active-children case).
- `backend/tests/test_roles.py` — same in `_persona` (never-creates-`ALUMNO`/never-touches-link case).

No assertion, status-code, JSON-body, or test-name line was modified. `git diff -U0 -- backend/tests | grep -E '^[+-]' | grep -icE 'assert|status_code|json\(\)'` → **0**.

## Strict-TDD evidence (RED → GREEN, plus neutrality and state-identity proofs)

The PR 4 database lock does not exist on this predecessor (`alembic head` = `h1140rep_auditoria`), so RED could not come from the repository alone. Temporary, out-of-repo oracle comparison was used: a throwaway pytest plugin (`/tmp/pr4a0_trigger_plugin.py`, **not** added to the repository) imports the read-only oracle migration `i1141relinteg` and installs its real relationship trigger after the session schema is migrated, recreating the verifier's lane conditions.

| Phase | Command (cd `backend`; `AMBIENTE=test TEST_DATABASE_URL/DATABASE_URL=postgresql+psycopg://usuario:password@localhost:5436/cataclub_test JWT_SECRET_KEY=verify-read-only`) | Result |
|---|---|---|
| RED (before corrections) | `PYTHONPATH=/tmp uv run pytest tests/test_alertas_mora.py tests/test_alertas_vencimiento.py tests/test_membresia_repositorio.py tests/test_notificaciones_marcar_todas.py tests/test_roles.py -q -p pr4a0_trigger_plugin -p no:randomly` | **7 failed, 58 passed** — exactly the oracle's blocker list, including the seventh failure the report only implied: `test_representante_recibe_una_sola_notificacion_en_reintento`. Every failure was `CheckViolation: persona_id=N es mayor de edad y no puede vincularse o re-enlazarse a un representante`. |
| GREEN (after corrections, lock installed) | same plugin, all 12 touched files | **167 passed, 7 warnings in 32.85s** |
| Neutrality (no lock, native branch head) | same 12 files without the plugin | **167 passed, 7 warnings in 32.46s** — identical count, proving the recipe depends on nothing new and the suite is not weakened. |
| State identity (structural probe) | `uv run python /tmp/pr4a0_state_probe.py` (throwaway, everything ROLLBACK-ed) | **PASS** — inside one transaction: legacy recipe `INSERT` adult + `representante_id` is rejected (`persona_id=6 es mayor de edad…`); corrected recipe (minor `INSERT` + `UPDATE fecha_nacimiento`) persists `(1990-01-01, representante_id=<same>, activo=True, telefono='0991112222')`, i.e. the exact state the legacy recipe intended; `persona` row count returned to 0 and the `persona` triggers were restored to the `h1140` head state (`trg_persona_representante_alcanzable`). |
| Lint / whitespace | `uv run ruff check` on all 12 files; `git diff --check` | **All checks passed!**; no whitespace findings |

Because the corrections only change *how* a row is seeded and leave the persisted row identical, the existing assertions are themselves the regression test: the adult-control and independence tests that pass with the lock installed prove the fixtures still end as linked adults (e.g. `test_desactivar_cuenta_con_representado_mayor_de_edad_no_se_rechaza`, `_representado_adulto`-driven independence cases).

## Interrupted canonical lane (recorded, not claimed)

`COMPOSE_PROJECT_NAME=pi-1137-pr4a AMBIENTE=test … make pre-pr LANE=backend` was started and **interrupted by the executor timeout during the backend pytest suite** (last log line at 83 % of `test_seed_dev_bulk.py`, backend suite, `0 FAILED / 0 ERROR`). Gates completed before interruption: `ruff check .` → `All checks passed!`; `lint-imports` → `Contracts: 3 kept, 0 broken.`; `pip-audit` → `No known vulnerabilities found`; `db-test` recreated and healthy. The lane result is **not** claimed as PASS; `test-root` never ran and remote CI gates are not claimable locally. No pytest/alembic process survived the interruption (`pgrep -af 'pytest|alembic'` empty).

## Review workload, rollback, deviations

- Authored count (test files only): **+107 / −28 = 135 changed lines** across 12 files — far inside the 600–900 target and the 1,000 hard stop. This apply-progress section is SDD bookkeeping and is excluded from that count. Zero production lines.
- Rollback boundary: `git checkout -- backend/tests/` on this worktree (the 12 renamed fixtures) plus reverting this section; nothing else exists to revert — no migration, no service/router/DTO, no endpoint or runtime behavior change. Any rollback of the later PR4a migration is separate.
- Runtime: **N/A** — no endpoint or UI surface; the slice only changes test seed order. Recorded here for the PR body per `tasks.md`.
- Deviations from the oracle: one docstring wording adaptation (revision id replaced by "el candado de relación de PR 4"); no executable divergence in the seven copied files.
- Not done here (PR4a/PR4b scope, still unchecked in `tasks.md`): the additive trigger migration, the shared validator, atomic reassignment, non-disclosing safe stop, and all PR 4 checkboxes.

## Remaining tasks

Unchanged from PR3b. The three PR 4 implementation lines are still persisted as unchecked and were **not** edited by this slice:

```text
- [ ] Shared validator owns self/cycle/age/phone/reachability invariants with database defense.
- [ ] Atomic reassignment with documented lock order, stale conflict, audit, epoch revocation, and post-commit notification.
- [ ] Non-disclosing safe stop replaces self-service linking.
```
