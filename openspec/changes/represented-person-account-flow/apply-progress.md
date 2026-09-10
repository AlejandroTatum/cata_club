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
