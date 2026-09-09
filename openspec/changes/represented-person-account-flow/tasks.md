# Implementation Tasks — Represented-person account flow

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 4,080–5,135 across 14 child PRs; each planned child is 180–400 changed lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Draft tracker → PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7 → PR 8 → PR 9 → PR 10 → PR 11 → PR 12 → PR 13 → PR 14 |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |
| Expected PR count | 1 draft/no-merge tracker + 14 implementation child PRs |
| Highest-risk slices | PR 2 independence, PR 3 capability/account core, PR 9 database safeguards, PR 11 reassignment effects, PR 12 atomic enrollment |
| Cumulative estimate | 4,080–5,135 additions + deletions |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

All estimates are one honest slicing pass. No planned slice exceeds 400 changed lines; do not compress code, tests, migrations, or documentation to preserve that estimate. If implementation proves a cohesive slice cannot fit, stop after the slice's one slicing pass and record its smallest honest estimate plus explicit `size:exception` approval before continuing.

## Governing inputs and ownership

- Implement against `openspec/changes/represented-person-account-flow/proposal.md`, `design.md`, and every specification under `openspec/changes/represented-person-account-flow/specs/`.
- Preserve the safety order: independence exit first; invalid entry-path closure and complementary contracts second; incompatible-account remediation last.
- **#1132 owns** active-player truth across membership, roster, scheduling, attendance, and frontend projections.
- **#1133 owns** relationship lifecycle, unified validation, database safeguards, audit, reassignment, revocation, and notification effects.
- **#1134 owns** account-first representative capability and empty dashboard; it does not own independence.
- **#1135 owns no work**: do not add runtime behavior, migration, relationship state, or closure work for it.
- **#1138 owns** minor prohibited fields and representative-derived emergency contact; it does not own legacy-account cleanup.
- **#1137 owns** the complete flow, safety order, authenticated enrollment/payment conservation, remediation gates, and final integration.

## Chain map and rollback rule

```text
main
  └─ draft tracker: #1137 represented-person-account-flow
       └─ PR 1  additive audit/idempotency foundation
            └─ PR 2  administrator independence exit
                 └─ PR 3  account-first representative capability backend
                      └─ PR 4  empty representative dashboard
                           └─ PR 5  backend ACTIVA player truth
                                └─ PR 6  frontend/BFF player projections
                                     └─ PR 7  minor contact API and derived reads
                                          └─ PR 8  minor contact forms and BFF contract
                                               └─ PR 9  relationship database safeguards
                                                    └─ PR 10 unified lifecycle validation and safe stop
                                                         └─ PR 11 administrator reassignment effects
                                                              └─ PR 12 session-derived enrollment and atomic persistence
                                                                   └─ PR 13 payment conservation and integrated enrollment UX
                                                                        └─ PR 14 remediation inventory/rehearsal gates
```

Every child targets its immediate predecessor and carries a dependency diagram with the current PR marked `📍`. Rollback is only against that immediate parent. Slices 1–13 must preserve person, relationship, membership, payment, medical, attendance, consent, and audit records; PR 14 does not execute production deletion and rolls back by discarding its evidence/tooling change.

## PR 1 — Additive relationship-audit and idempotency foundation

**Owner:** #1137 with #1133. **Estimate:** 180–260 changed lines. **Dependency:** tracker only. **Start:** existing `vinculacion_representante` schema and `g1139repmenor_representados_menores_alcanzables.py`. **Finish:** append-only audit can represent create/reassign/independence/removal and replay keys without changing current authorization or closing an entry path. **Rollback:** revert the new additive migration/model/repository files before any later slice depends on them; never delete historical audit rows. **Focused command:** `cd backend && uv run pytest tests/test_vinculacion_representante.py tests/test_migracion_representante_auditoria.py -q` (new files allowed). **Runtime:** migrate an isolated PostgreSQL test database from empty to head, insert a legacy audit row, replay a keyed event, and verify the row is immutable. **Chain docs:** PR body records `main → tracker → 📍 PR 1`, migration parent, rollback, and exact counts.

- [ ] **RED:** Add PostgreSQL/model/repository tests at `backend/tests/test_migracion_representante_auditoria.py` and `backend/tests/test_vinculacion_representante.py` for nullable new representative, actor/origin/operation checks, fingerprint pairing, indexes, and keyed replay; run the focused command and preserve the failing output. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add the additive Alembic revision under `backend/alembic/versions/` after `g1139repmenor_representados_menores_alcanzables.py`, extend `backend/app/dominio/modelos.py`, and update the relationship repository without changing `Persona.representante_id`; make the RED suite pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test empty-to-head migration, legacy backfill, invalid operation/value combinations, duplicate idempotency keys, and direct SQL attempts; record `make test-root` and migration results in the PR evidence. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep the ledger append-only and separate from authorization, run `make test-compose` plus the focused suite, and document the migration/rollback boundary in the child PR. <!-- sdd-owner: implementation -->

## PR 2 — Administrator independence exit

**Owner:** #1137 using #1133 safeguards. **Estimate:** 340–395 changed lines. **Dependency:** PR 1. **Start:** a represented adult has no safe account transition. **Finish:** an authorized in-person administrator creates or updates verified credentials on the unchanged `persona_id`, establishes only `REPRESENTANTE`, removes the adult link atomically, revokes affected epochs, audits the removal, and best-effort notifies after commit; debt does not block it and minors remain linked. **Rollback:** revert the endpoint/service/core before remediation; transaction rollback must retain the original link and all history. **Focused command:** `cd backend && uv run pytest tests/test_independencia_representada.py tests/test_personas.py -q`. **Runtime:** `make qa-up`, perform an admin independence request for an adult with debt, verify login/portal and preserved records, then attempt the same flow for a minor. **Chain docs:** PR body records the safety-first rationale and no remediation dependency.

- [ ] **RED:** Add failing service/router tests at `backend/tests/test_independencia_representada.py` covering admin-only access, same-person account creation, verified email, debt bypass, minor rejection, legacy multi-role rejection, idempotent retry, rollback, audit, epoch revocation, and post-commit notification failure. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement the no-commit existing-person account core in `backend/app/servicios_negocio/auth_servicio.py`, capability handling in `backend/app/servicios_negocio/rol_servicio.py`, orchestration in new `backend/app/servicios_negocio/relacion_representacion_servicio.py`, and the existing admin route at `backend/app/presentacion/routers/personas_router.py`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Exercise PostgreSQL locks, normalized-email conflicts, `g1139` minor reachability, exact `persona_id` conservation, stale epochs, audit replay, and notification failure after commit; run the focused suite against `db-test` and record results. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Remove duplicate relationship/account writes from `backend/app/servicios_negocio/persona_servicio.py`, preserve one commit/no token behavior, run `make lint-backend` and the focused suite, and record the independence runtime result. <!-- sdd-owner: implementation -->

## PR 3 — Account-first representative capability backend

**Owner:** #1134. **Estimate:** 350–400 changed lines. **Dependency:** PR 2. **Start:** no public account-first adult representative contract. **Finish:** rate-limited `POST /representante/cuenta` creates one unverified adult account, one persisted `REPRESENTANTE` capability, legal consents, and verification outbox atomically without membership, relationship, or token; existing-person account creation uses the same capability core. **Rollback:** revert endpoint/core and leave existing accounts and audit evidence intact. **Focused command:** `cd backend && uv run pytest tests/test_representante_cuenta.py tests/test_auth.py tests/test_roles.py -q`. **Runtime:** `make qa-up`, register an adult, confirm no token/link/membership, verify email through existing `/auth/verificar-correo`, log in, and inspect `GET /api/v1/.../student` capability. **Chain docs:** PR body identifies #1134 and explicitly excludes independence/remediation.

- [ ] **RED:** Add failing API/service tests at `backend/tests/test_representante_cuenta.py` for adult-only DTOs, idempotency replay/conflict, email verification boundary, consent/outbox atomicity, exact single role, no membership/link/token, and no `AdminCuentaServicio` call. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add `backend/app/servicios_negocio/cuenta_representante_servicio.py`, shared non-committing account/capability helpers in `backend/app/servicios_negocio/auth_servicio.py` and `rol_servicio.py`, DTOs under `backend/app/servicios_negocio/dtos/`, and route wiring in `backend/app/presentacion/routers/auth_router.py`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test duplicate identity/email, consent/outbox/role failure rollback, #762 single-role trigger, unverified portal denial, verified zero-link access, and dependency injection/rate-limit behavior; run the focused suite plus `make test-root`. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep `REPRESENTANTE` as persisted capability rather than link-count inference, remove obsolete account writer coupling, run `make lint-backend`, and record the QA registration/verification scenario. <!-- sdd-owner: implementation -->

## PR 4 — Empty representative dashboard

**Owner:** #1134. **Estimate:** 180–250 changed lines. **Dependency:** PR 3. **Start:** portal assumes a student or represented person. **Finish:** a verified capability with zero links sees a safe empty representative dashboard; capability and person-scoped authorization remain separate. **Rollback:** revert only dashboard projection/UI changes; retain the account contract. **Focused command:** `cd frontend && pnpm vitest run src/app/student/__tests__/StudentPage.test.tsx src/lib/server/__tests__/student-adapter.test.ts`. **Runtime:** `make qa-up && make qa-live` with a verified zero-link representative opening `/student` and attempting an unrelated person URL. **Chain docs:** PR body links PR 3 and states no relationship authority comes from dashboard state.

- [ ] **RED:** Add failing tests at `frontend/src/app/student/__tests__/StudentPage.test.tsx`, `frontend/src/lib/server/__tests__/student-adapter.test.ts`, and the backend student response test for `capabilities.representante=true`, `representados=[]`, no membership/player access, and denied arbitrary-person data. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `frontend/src/app/student/page.tsx`, `frontend/src/lib/server/student-adapter.ts`, `frontend/src/types/domain.ts`, and the backend student/dashboard DTO projection to render the empty state from server capability; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test unverified accounts, former representatives after link removal, forged `personaId`, empty/loading/error states, and direct backend authorization; run the focused Vitest suite and `pnpm exec playwright test` for the affected student route. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep the empty dashboard accessible without membership or links, run `pnpm type-check` and `pnpm lint`, and record the live QA scenario. <!-- sdd-owner: implementation -->

## PR 5 — Backend ACTIVA player truth

**Owner:** #1132. **Estimate:** 300–390 changed lines. **Dependency:** PR 4. **Start:** roles, payment history, and existing membership checks can influence player surfaces inconsistently. **Finish:** `Membresia.estado == ACTIVA` is the sole backend player predicate for roster, schedules, and attendance; a `REPRESENTANTE` without `ALUMNO` can play when active, and inactive membership never grants player access. **Rollback:** revert predicate consumers while preserving memberships and historical attendance. **Focused command:** `cd backend && uv run pytest tests/test_jugador_activo.py tests/test_membresia_repositorio.py tests/test_asistencias.py tests/test_horario_repositorio.py -q`. **Runtime:** `make qa-up`, seed active/inactive representative accounts, verify roster/schedule/attendance inclusion and rejection without altering capability. **Chain docs:** PR body maps every changed consumer to #1132.

- [ ] **RED:** Add failing backend tests at `backend/tests/test_jugador_activo.py` and extend `backend/tests/test_membresia_repositorio.py`, `test_asistencias.py`, and `test_horario_repositorio.py` for active-only eligibility, representative-without-`ALUMNO`, inactive exclusion, and duplicate payment outcomes. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add `es_jugador_activo` and `existe_activa_por_persona` in `backend/app/servicios_negocio/membresia_pago_servicio.py` and `backend/app/infraestructura/repositorios/membresia_repositorio.py`; update `backend/app/servicios_negocio/asistencia_servicio.py` and roster/schedule consumers; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test set-based projections, expired/suspended memberships, role-only accounts, historical attendance preservation, and payment approval/rejection boundaries against PostgreSQL; record focused and root-test results. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Remove role-as-player gates and lazy `ALUMNO` assignment from membership creation without changing capability removal, run `make lint-backend`, and record the QA roster scenario. <!-- sdd-owner: implementation -->

## PR 6 — Frontend/BFF membership-derived player projections

**Owner:** #1132. **Estimate:** 300–390 changed lines. **Dependency:** PR 5. **Start:** frontend derives player state from roles, links, or payment heuristics. **Finish:** member, dashboard, portal, and BFF projections consume authoritative membership/player fields and reject browser-selected subjects. **Rollback:** revert frontend adapters/routes/types/tests; backend membership truth remains. **Focused command:** `cd frontend && pnpm vitest run src/lib/server/__tests__/members-adapter.test.ts src/lib/server/__tests__/student-adapter.test.ts src/app/student/__tests__/student-utils.test.ts`. **Runtime:** `make qa-up && make qa-live` with active, inactive, representative-only, and forged-person scenarios. **Chain docs:** PR body records the browser-authority boundary.

- [ ] **RED:** Add failing Vitest/Playwright tests at `frontend/src/lib/server/__tests__/members-adapter.test.ts`, `frontend/src/lib/server/__tests__/student-adapter.test.ts`, `frontend/src/app/student/__tests__/student-utils.test.ts`, and affected route tests for membership-state projection and forged `personaId`. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `frontend/src/app/api/student/route.ts`, `frontend/src/app/api/members/route.ts`, `frontend/src/lib/server/student-adapter.ts`, `frontend/src/lib/server/members-adapter.ts`, `frontend/src/types/domain.ts`, and dashboard/member/student consumers; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test role/link mismatch, payment rejection preserving portal access, active representative without `ALUMNO`, mocked and live backend responses, and API error pass-through; run focused Vitest and affected Playwright specs. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Consolidate one `isActivePlayer`/membership-state mapping, run `pnpm type-check` and `pnpm lint`, and record the live projection scenario. <!-- sdd-owner: implementation -->

## PR 7 — Minor contact API and derived operational reads

**Owner:** #1138. **Estimate:** 300–390 changed lines. **Dependency:** PR 6. **Start:** person and medical DTOs can accept minor phone, school, and free-text emergency fields. **Finish:** APIs explicitly reject prohibited fields, valid representative phone is required for links, and operational emergency contact reads current representative name/phone while ignoring legacy values. **Rollback:** revert DTO/service/projection changes; retain legacy stored values and historical records. **Focused command:** `cd backend && uv run pytest tests/test_ficha_emergencia.py tests/test_ficha_medica_representante.py tests/test_minor_contact_contract.py -q`. **Runtime:** `make qa-up`, create/read a represented minor with legacy values, reassign representative, and verify only the current valid contact is returned. **Chain docs:** PR body distinguishes #1138 from remediation.

- [ ] **RED:** Add failing API/service tests at `backend/tests/test_minor_contact_contract.py`, `test_ficha_emergencia.py`, and `test_ficha_medica_representante.py` for omitted versus explicit null/empty/populated prohibited fields, adult emergency requirements, legacy-value omission, and concurrent phone invalidation. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `backend/app/servicios_negocio/dtos/persona_schemas.py`, the ficha-medical DTO/service modules under `backend/app/servicios_negocio/`, `backend/app/servicios_negocio/persona_servicio.py`, and `backend/app/presentacion/routers/ficha_medica_router.py`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test every DTO/BFF matrix cell before mutation, representative phone regex parity with `_RE_TELEFONO_FORMA`, reassignment read-after-commit, and adult-without-representative validation using real PostgreSQL. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep legacy values storage-compatible but operationally unreachable, run `make lint-backend` and the focused suite, and record the derived-contact QA scenario. <!-- sdd-owner: implementation -->

## PR 8 — Minor contact forms and BFF contract

**Owner:** #1138. **Estimate:** 250–340 changed lines. **Dependency:** PR 7. **Start:** frontend forms expose prohibited minor fields and may hide backend validation. **Finish:** minor phone/school/credentials/free-text emergency controls and payload mappings are removed, BFF forwards backend rejection unchanged, and derived contact is displayed read-only. **Rollback:** revert form/BFF/type changes without altering persisted legacy data. **Focused command:** `cd frontend && pnpm vitest run src/app/student/add-dependent/__tests__/add-dependent-utils.test.ts src/app/student/enroll/__tests__/enrollmentPayload.test.ts src/app/student/medical-record/__tests__/StudentMedicalRecordPage.test.tsx`. **Runtime:** `make qa-up && make qa-live` through dependent creation and medical-contact flows. **Chain docs:** PR body records prohibited-field behavior and no silent discard.

- [ ] **RED:** Add failing tests at `frontend/src/app/student/add-dependent/__tests__/add-dependent-utils.test.ts`, `frontend/src/app/student/enroll/__tests__/enrollmentPayload.test.ts`, `frontend/src/app/student/medical-record/__tests__/StudentMedicalRecordPage.test.tsx`, and new BFF route tests for explicit prohibited fields. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `frontend/src/app/student/add-dependent/page.tsx`, `add-dependent-utils.ts`, `frontend/src/app/student/enroll/page.tsx`, enrollment types/adapters, `frontend/src/app/api/fichas-medicas/persona/[id]/route.ts`, and `frontend/src/types/domain.ts`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test null/empty/populated forbidden fields, adult emergency controls, current-versus-former representative contact, backend 422 pass-through, and no partial browser state; run focused Vitest and affected Playwright specs. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Centralize minor-form field omission and accessible error/empty states, run `pnpm type-check` and `pnpm lint`, and record the live form scenario. <!-- sdd-owner: implementation -->

## PR 9 — PostgreSQL relationship safeguards

**Owner:** #1133. **Estimate:** 280–390 changed lines. **Dependency:** PR 8. **Start:** application checks are not sufficient against direct SQL/concurrent graph writes. **Finish:** additive migration and domain helpers reject self-links, indirect cycles, adult new/re-links, invalid destination phones, unsafe active-minor unlink/reachability, and concurrent graph races while permitting aged-in-place adult independence. **Rollback:** only revert before PR 10 relies on the trigger; use a tested database backup and never downgrade after dependent production data exists. **Focused command:** `cd backend && uv run pytest tests/test_representacion_triggers.py tests/test_representados_alcanzables.py -q`. **Runtime:** migrate isolated PostgreSQL, execute direct SQL self-link/two-node/three-node cycle/adult-link/phone/unlink cases, and verify graph preservation. **Chain docs:** PR body includes trigger names, advisory-lock key, migration parent, and downgrade warning.

- [ ] **RED:** Add failing direct-SQL/concurrency tests at `backend/tests/test_representacion_triggers.py` and extend `backend/tests/test_representados_alcanzables.py` for all database-boundary scenarios in `representation-lifecycle/spec.md`. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add the next Alembic revision after `g1139repmenor_representados_menores_alcanzables.py`, update `backend/app/dominio/representados_alcanzables.py`, `backend/app/dominio/modelos.py`, and repository lock helpers; make RED pass without adding a second relationship projection. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Run empty-to-head migration, concurrent graph writes with PostgreSQL advisory lock, unrelated aged-in-place adult updates, invalid phone changes with active minors, and existing trigger regression tests; record `make test-root`. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep trigger scope limited to relationship/phone writes and `IS NOT DISTINCT FROM` short-circuiting, run `make test-compose` and `make lint-backend`, and document safe downgrade boundary. <!-- sdd-owner: implementation -->

## PR 10 — Unified lifecycle validation and non-disclosing safe stop

**Owner:** #1133. **Estimate:** 300–390 changed lines. **Dependency:** PR 9. **Start:** create/change/remove paths have separate validation and old self-service lookup can disclose or mutate relationships. **Finish:** `RelacionRepresentacionServicio` owns create/reassign/independence validation; legacy self-service replacement returns one non-disclosing administrator stop; only current `Persona.representante_id` authorizes access. **Rollback:** revert service/router behavior while retaining additive audit and database defenses. **Focused command:** `cd backend && uv run pytest tests/test_relacion_representacion_servicio.py tests/test_personas.py tests/test_politica_acceso.py -q`. **Runtime:** `make qa-up`, submit ambiguous/existing/forged self-service requests and verify identical safe-stop responses with no mutation. **Chain docs:** PR body marks `📍 PR 10` and lists old route replacement.

- [ ] **RED:** Add failing tests at `backend/tests/test_relacion_representacion_servicio.py`, `test_personas.py`, and `test_politica_acceso.py` for shared invariants, historical-representative denial, safe-stop non-disclosure, no request state, and idempotent validation. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement the shared validator/commands in `backend/app/servicios_negocio/relacion_representacion_servicio.py`, delegate `representante_id` changes from `persona_servicio.py`, and replace `backend/app/presentacion/routers/personas_router.py` legacy linking behavior; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test direct route/backend bypass, self/cycle/age/phone/reachability conflicts, old audit not granting access, syntactic 422 versus safe 409, and rollback with no notification; run focused tests against PostgreSQL. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Remove duplicate validators and preserve live relationship authorization in `backend/app/servicios_negocio/politica_acceso.py`, run import/lint checks, and record the safe-stop runtime result. <!-- sdd-owner: implementation -->

## PR 11 — Administrator reassignment, audit, revocation, and notification effects

**Owner:** #1133. **Estimate:** 340–400 changed lines. **Dependency:** PR 10. **Start:** no complete administrator reassignment transaction/effect boundary. **Finish:** in-person admin reassignment atomically replaces the relationship and audit, increments the former representative epoch, commits before best-effort existing-channel notification, and rejects stale observed state. **Rollback:** revert admin route/effects only; never reverse a committed relationship by deleting audit history. **Focused command:** `cd backend && uv run pytest tests/test_reasignacion_representacion.py tests/test_notificaciones_relacion.py -q`. **Runtime:** `make qa-up`, reassign a minor between two valid representatives, verify old-session denial/current-contact change, then simulate notification failure. **Chain docs:** PR body includes exact lock order and post-commit boundary.

- [ ] **RED:** Add failing tests at `backend/tests/test_reasignacion_representacion.py` and `test_notificaciones_relacion.py` for admin authorization, identity evidence, lock ordering, stale conflict, atomic audit, epoch revocation, current-contact projection, notification-after-commit, and notification failure. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add the administrator route/schema in `backend/app/presentacion/routers/personas_router.py` (or its established admin router), repository locked reads, audit writes, session epoch updates, and existing `Notificacion` integration; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test concurrent reassignment, equivalent idempotent retry, distinct stale retry, rollback before commit, former representative access, and absence of relationship outbox/request tables; run focused tests and `make test-root`. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep notification work in a separate post-commit transaction with neutral copy/structured failure logging, run `make lint-backend`, and record the QA reassignment scenario. <!-- sdd-owner: implementation -->

## PR 12 — Authenticated session-derived enrollment and atomic persistence

**Owner:** #1137 with #1133 and #1138. **Estimate:** 380–400 changed lines. **Dependency:** PR 11. **Start:** public/client-selected child enrollment can create dependent identity/credentials or split writes. **Finish:** authenticated verified `REPRESENTANTE` session creates/reuses a person with server-derived actor, allowed medical data, complete consent/audit, one `INACTIVA` membership, and one pending payment in one commit; no dependent `Usuario`/`ALUMNO` role; ambiguous identities stop safely. **Rollback:** revert the new command/BFF contract before payment integration; failed transactions leave zero new domain rows. **Focused command:** `cd backend && uv run pytest tests/test_representado_enrollment.py tests/test_enrollment_idempotencia.py tests/test_enrollment_servicio.py -q`. **Runtime:** `make qa-up`, create a represented person with an authenticated representative, retry the same key, submit forged actor/credential fields, and inspect persisted rows. **Chain docs:** PR body includes lock order, idempotency fingerprint, and no-dependent-credentials proof.

- [ ] **RED:** Add failing backend/API tests at `backend/tests/test_representado_enrollment.py` and extend `test_enrollment_idempotencia.py`/`test_enrollment_servicio.py` for session authority, safe reuse, non-disclosure, prohibited credentials, consent/medical/audit/payment rollback, one inactive membership, and retry behavior. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add the session-derived command to `backend/app/servicios_negocio/relacion_representacion_servicio.py`, DTOs in `backend/app/servicios_negocio/dtos/persona_schemas.py` and enrollment schemas, route `POST /representados` in `backend/app/presentacion/routers/personas_router.py`, and repository transaction helpers; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Test forged body/URL/BFF actor, identity races, duplicate pending-payment constraints, every failure rollback, legal-consent linkage, direct backend bypass, and exact response omission of credentials/token; record focused and migration tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Remove the public child branch from `backend/app/servicios_negocio/enrollment_servicio.py` while retaining adult self-enrollment, centralize fingerprints, run `make lint-backend`, and record the authenticated QA scenario. <!-- sdd-owner: implementation -->

## PR 13 — Payment conservation and integrated enrollment UX

**Owner:** #1137 with #1132. **Estimate:** 280–360 changed lines. **Dependency:** PR 12. **Start:** enrollment persistence and payment verdicts are not verified as one conservation contract in frontend/live flows. **Finish:** approval activates only the linked membership; rejection preserves relationship, `INACTIVA` membership, medical/audit/consent records, representative capability, and non-player portal access; BFF/UI exposes the committed state and no dependent token. **Rollback:** revert payment/enrollment client consumers; preserve committed domain rows and payment history. **Focused command:** `cd backend && uv run pytest tests/test_pago_enrollment_conservation.py -q && cd ../frontend && pnpm vitest run src/app/student/add-dependent/__tests__/add-dependent-harness.tsx src/lib/server/__tests__/enrollment-adapter.test.ts`. **Runtime:** `make qa-up && make qa-live`, enroll, approve once, reject once in separate seeded cases, and reload the portal. **Chain docs:** PR body maps payment outcomes to #1132 and #1137.

- [ ] **RED:** Add failing backend tests at `backend/tests/test_pago_enrollment_conservation.py` and frontend tests at `frontend/src/lib/server/__tests__/enrollment-adapter.test.ts` plus dependent-flow harness coverage for approval, rejection, duplicate verdict, and response conservation. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Update `backend/app/servicios_negocio/membresia_pago_servicio.py`, `backend/app/presentacion/routers/membresias_pagos_router.py`, `frontend/src/app/api/representados/route.ts`, `frontend/src/lib/server/enrollment-adapter.ts`, and `frontend/src/app/student/add-dependent/`; make RED pass. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Verify no relationship/capability/session removal on rejection, only the linked membership activates on approval, duplicate outcomes are idempotent, server financial snapshots remain authoritative, and live reload reflects state; run focused tests and `make qa-live`. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep payment validation's existing `FOR UPDATE` boundary, remove client-selected financial/actor fields, run `pnpm type-check`, `make lint-backend`, and record exact live results. <!-- sdd-owner: implementation -->

## PR 14 — Remediation inventory, rehearsal, and conservation gate

**Owner:** #1137. **Estimate:** 300–380 changed lines. **Dependency:** PR 13. **Start:** incompatible dependent accounts cannot be inventoried/rehearsed with a hard stop. **Finish:** read-only inventory, signed/versioned evidence, QA/staging rehearsal, restoration/revocation/conservation checks, candidate fingerprint drift detection, idempotent receipts, and stop-before-delete gate exist; production remediation is not executed. **Rollback:** remove the script/runbook/gate and its tests; future account restoration uses protected backup and batch receipts, never deletion of conserved records. **Focused command:** `cd backend && uv run pytest ../tests/test_remediacion_representada.py tests/test_remediacion_inventario.py -q`. **Runtime:** run the exact inventory/rehearsal against QA data, mutate one candidate between approval and execution, and verify the gate stops before credential/role writes. **Chain docs:** PR body labels this as final behavior slice and explicitly says #1135 has no work.

- [ ] **RED:** Add failing gate/conservation tests at `backend/tests/test_remediacion_inventario.py`, `../tests/test_remediacion_representada.py`, and new script tests for missing/changed inventory, failed rehearsal/restoration/revocation/conservation, active-minor reachability, retry receipts, and retired-email non-reservation. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Add read-only inventory and rehearsal tooling under `backend/scripts/` (including a focused runbook beside the script), batch evidence/receipt models only if required by the design, and hard-stop checks; make RED pass without production deletion execution. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Rehearse representative QA data, compare people/relationships/memberships/payments/medical/attendance/consent/audit hashes, test candidate drift and session epoch proof, and record the exact no-delete result. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Keep remediation isolated from normal account flows, document restoration and rollback boundaries, run `make test-root`, `make lint-backend`, and the focused command, and attach the rehearsal evidence. <!-- sdd-owner: implementation -->

## Parent-owned SDD and delivery housekeeping

These tasks do not add feature behavior and must remain separate from child implementation PRs.

- [ ] Create and maintain the draft/no-merge tracker PR for `#1137`, chain each child to its immediate predecessor, include the dependency diagram with `📍`, and keep each child diff limited to its stated work unit. <!-- sdd-owner: parent -->
- [ ] Preserve `proposal.md`, `design.md`, and all `specs/**/spec.md`; update only SDD evidence/status artifacts in `openspec/changes/represented-person-account-flow/` when implementation results require it. <!-- sdd-owner: parent -->
- [ ] Before each child delivery, verify the exact focused command, runtime scenario, additions+deletions, rollback boundary, and skipped CI gates; run one applicable `make pre-pr LANE=backend|frontend|full` lane for the child. <!-- sdd-owner: parent -->
- [ ] After the chain is complete, compare implementation against every Given/When/Then scenario and authorization invariant, then record verification evidence in the change artifacts before archive. <!-- sdd-owner: parent -->
- [ ] Keep #1135 explicitly superseded with no runtime, migration, relationship, or closure work; close #1132, #1133, #1134, #1138, and #1137 only against their stated completion conditions. <!-- sdd-owner: parent -->
- [ ] Archive the completed OpenSpec change only after all child PRs, migration checks, QA/live scenarios, conservation evidence, and post-merge lifecycle gates pass; do not claim production remediation execution. <!-- sdd-owner: parent -->

## Apply guardrails

- Strict TDD evidence is mandatory for every child: RED failing test, GREEN minimal implementation, TRIANGULATE adversarial/integration evidence, and REFACTOR architecture/quality evidence.
- Backend tests use real PostgreSQL through `db-test`; do not substitute SQLite or run concurrent backend suites against the single-tenant service.
- The feature chain is not permission to force-push, merge red/pending CI, modify production configuration, or execute destructive remediation.
