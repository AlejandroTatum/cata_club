# Exploration — `represented-person-account-flow`

**Phase:** SDD explore  
**Worktree:** `/home/alejo/devwork/apps/cata_club-worktrees/pi-1137`  
**Branch:** `fix/represented-person-account-flow`  
**Skill resolution:** `paths-injected` (`gentle-ai`, `chained-pr`, `work-unit-commits` were loaded by the parent phase)  
**Implementation status:** exploration only; no feature code was changed.  
**Research status:** external research was not selected; this artifact uses the confirmed issue handoff and repository evidence.

## Evidence boundary

- **Issue evidence** means the confirmed product handoff for GitHub #1137, #1132–#1135, and #1138/comments supplied for this exploration. GitHub comments were not independently fetched in this runtime, so no comment is presented as independently verified.
- **Repository evidence** means behavior observed in this worktree. Where it conflicts with the handoff, the handoff is the target contract and the repository is the current baseline.
- Product, provider, deployment, and ownership decisions remain owned by the linked `cata_club-docs` repository; this artifact does not replace those decisions.

## Confirmed target contract

### Canonical three-stage order from #1137

1. **Creation:** during authenticated child enrollment, derive the representative from the authenticated session and create/link the child relationship immediately and atomically. A later rejected payment does not undo the relationship; it leaves the membership `INACTIVA`.
2. **Reassignment:** there is no self-service pending request and no disclosure of the looked-up person. The flow stops safely and routes the operation to an in-person administrator, who atomically replaces `Persona.representante_id`.
3. **Independence:** an in-person administrator performs the operation for an adult. Debt does not block it. The administrator captures and verifies a current email, creates `Usuario` using the same `persona_id`, revokes affected access, and records the audit event. No dependent self-service actor remains.

### Complementary contracts

- `Persona.representante_id` is the sole current relationship projection. Do not add a parallel relationship lifecycle state, approval flag, or request status.
- `APROBADO` and `RECHAZADO` are payment states only. `APROBADO` activates membership; `RECHAZADO` preserves the already-created relationship and leaves membership `INACTIVA`.
- `Membresia.estado = ACTIVA` is the gate for player/member visibility: active-member roster, scheduling, and attendance eligibility. Do not infer a broader loss of financial or representative portal access.
- `REPRESENTANTE` is a capability, not membership and not a second player role. An adult representative account may enter an empty dashboard before a dependent exists.
- Child enrollment is session-derived. The backend must derive and authorize the representative, safely look up/reuse the child identity, and never create dependent credentials or an `ALUMNO` role.
- Initial creation, reassignment, and independence require durable audit evidence containing actor, date, origin, old representative, and new representative. The history may be append-only, but it must not become a second current-state projection.
- Notifications must reuse an available existing channel. No new durable relationship-approval or relationship-outbox requirement is authorized.
- Existing incompatible dependent accounts require inventory, QA/staging rehearsal, session revocation, conservation proof, and only then removal of `Usuario`/role. Retired emails must not be automatically reused or reserved.
- #1004 is closed/superseded as an admin-account tracker. Its general payment gate remains: active membership grants player access. The proposal must not invent an admin-account activation workflow. Independence still requires a current verified email and in-person identity verification.

## Repository map and current behavior

### Backend identity and account creation

- `backend/app/servicios_negocio/enrollment_servicio.py` implements public enrollment as one transaction, but the child path currently creates the adult representative account and may also create a child `Usuario` with `ALUMNO` when child credentials are supplied (`_crear_usuario_alumno`).
- `backend/app/servicios_negocio/dtos/enrollment_schemas.py` exposes optional child `correo`/`contrasenia`; this is directly contrary to the target no-dependent-credentials rule.
- The public representative account receives `REPRESENTANTE` only in the current branch, which is a useful partial precedent for capability-only representation.
- `backend/app/servicios_negocio/rol_servicio.py` assigns `ALUMNO` lazily from `MembresiaServicio.crear_membresia`, but the current service assigns it when an `INACTIVA` membership is created, not only after approval. The implementation must separate account/capability access from the `ACTIVA` player visibility gate without inventing an admin activation flow.
- `backend/app/seguridad/gestor_auth.py` gates public module access on verified email plus a historical/operational membership signal. It already has session epochs (`version_sesion`/`sver`) and `revocar_sesiones()`, which are reusable for access revocation, but token issuance and activation claims must be rechecked against the target flow.
- `backend/app/servicios_negocio/admin_cuenta_servicio.py` is intentionally retired. Admin account creation is not a viable new flow to extend without a separate product decision.

### Backend relationship, authorization, and independence

- `Persona.representante_id` is the current single relationship projection. `PoliticaAccesoPersona` grants access to a dependent when the requester is the current representative, and `exigir_acceso_directo` limits self-service operations to the target person or privileged roles.
- `PersonaServicio.crear_representado()` creates a new child, medical record, and optionally child account/role. The endpoint is `POST /personas/{persona_id}/representados`; the URL identity is checked against the authenticated token, but the payload and implementation still allow credentials.
- `PersonaServicio.vincular_representado()` is currently self-service and immediate: it accepts a cédula, reassigns `representante_id`, appends `VinculacionRepresentante`, and notifies the previous representative after commit. It has anti-enumeration, progressive delay, verified-email, and reachable-destination checks. This is materially different from the target in-person admin reassignment and must not be converted into a pending relationship request.
- `VinculacionRepresentante` currently stores `persona_id`, previous representative, new representative, and timestamp. It does not store the explicit actor, operation origin, or complete old/new audit contract. Its history is a reusable starting point, not a reason to add a current relationship state.
- `PersonaServicio.independizar()` currently validates adulthood, existing user/password, and debt conditions, then sets `representante_id = None` and commits. It preserves the same `Persona` row and medical data, and current tests explicitly require no automatic `REPRESENTANTE` role. The target instead requires an in-person admin operation, allows debt, captures/verifies a current email, creates `Usuario` on the same `persona_id`, revokes affected access, and records audit.
- `g1139repmenor_representados_menores_alcanzables.py` installs database triggers preventing an active minor from losing a reachable representative and preventing assignment to an inactive account. These triggers are important safety constraints. The three target stages must preserve them; independence is adult-only.

### Membership and payment state

- `Membresia` has `INACTIVA`, `ACTIVA`, `VENCIDA`, and `SUSPENDIDA`; `Pago` has `APROBADO`, `PENDIENTE_VALIDACION`, and `RECHAZADO`.
- `MembresiaServicio.crear_membresia()` creates `INACTIVA` and calls lazy `ALUMNO` assignment immediately. `validar_pago()` is the path that activates a membership after approval. Creation therefore needs to keep relationship creation atomic while making payment rejection preserve the relationship and `INACTIVA` membership.
- `GET /api/student`/`frontend/src/app/api/student/route.ts` currently fetches memberships through `/membresias/mias`, chooses an active/vencida membership, and builds a portal profile for the session person and representados. The adapter currently includes representados from `GET /personas/{id}/representados` and assumes the caller can read each profile.

### Frontend/BFF

- `frontend/src/app/student/page.tsx` has a `pending` mode for an authenticated person without `ALUMNO` and without representados. It displays self-enrollment and child-enrollment CTAs and membership plans; it is not the target empty representative dashboard.
- The active portal treats `representados.length > 0` as representative capability and renders dependent switching/actions. This is a useful UI seam, but capability must not be inferred only from existing children.
- `frontend/src/app/student/enroll/page.tsx` is a public enrollment wizard that supports both self and child flows and sends the public `EnrollmentRequest`; the child path is therefore not session-derived and can create child credentials under the current contract.
- `frontend/src/app/student/add-dependent/page.tsx` is already an authenticated representative wizard and deliberately documents “never creates a `Usuario` or assigns a role.” It obtains the representative ID from the portal summary and calls `crearRepresentado`; this is the closest existing frontend pattern to the target, but the backend still accepts optional credentials and currently gates it by the `REPRESENTANTE` role.
- `frontend/src/app/student/add-dependent/add-dependent-utils.ts` supports duplicate-identity detection followed by self-service `vincularRepresentado`. That fallback conflicts with target admin-only reassignment and must instead stop without disclosing the looked-up person.
- `frontend/src/app/api/student/route.ts` trusts the backend for authorization but accepts a `personaId` query parameter and forwards it to multiple backend calls. The backend must remain authoritative and session identity must not be substitutable by a URL parameter.
- `frontend/src/app/student/student-utils.ts` documents the current lazy-role/pending model. Those comments and tests will become stale if account-first representative capability replaces “pending until a membership exists.”

### Migrations and database safeguards

- `f1e2d3c4b5a6_agregar_representante_al_enum_tiporol.py` adds `REPRESENTANTE` to the role enum.
- `a790verifcorreo_verificar_correo_antes_de_representar.py` adds `Usuario.correo_verificado` and a durable verification outbox; new accounts are unverified by default.
- `d5e6f7a8b9c1_vinculacion_representante.py` creates the append-only relationship audit table but only records old/new representative IDs and date.
- `g1139repmenor_representados_menores_alcanzables.py` protects active minors from unreachable/no-representative states at the database boundary.
- No current migration records the required audit actor/origin fields or the independence account/access transition. A schema change may be needed for history completeness, but a parallel current relationship state is not a candidate.

## Test evidence and contradictions

- `backend/tests/test_enrollment_servicio.py` asserts that public child enrollment may create a child `Usuario` and `ALUMNO`; this is a direct regression lock for behavior the handoff now rejects.
- `backend/tests/test_independizar.py` asserts password validation, debt blocking, self-service access, preservation of the person row, and no automatic second role. Preservation/no-second-role align with identity integrity; password, debt, actor, email-verification, admin-only, audit, and revocation behavior must change.
- `backend/tests/test_vincular_representado.py` asserts immediate self-service reassignment, anti-enumeration, progressive delay, notification, and the current audit row. The target retains safe non-disclosure and history intent but supersedes self-service reassignment and its pending/request interpretation.
- `backend/tests/test_representante_no_deja_menores_huerfanos.py` and the migration trigger tests protect reachability. Any reassignment transaction must preserve the invariant that an active minor always has an active reachable representative.
- `frontend/tests/e2e/enrollment-representante.live.spec.ts` covers live public representative enrollment and auto-login. It is evidence for current public enrollment, not proof of the target account-first/authenticated child flow.
- Existing frontend utility tests cover the pending dashboard and authenticated dependent wizard. They do not cover an empty account-first representative dashboard, authenticated session-derived child enrollment, rejected payment preserving the relationship, in-person admin reassignment, or independence session invalidation.

## Architectural implications

1. **Use one current relationship projection.** Every current authorization/read path should use `Persona.representante_id`; relationship history is audit only and must not add a competing state or flag.
2. **Make the authenticated subject authoritative.** The child-enrollment command should accept child data plus session context, not a client-selected representative ID. FastAPI must derive and authorize the actor.
3. **Make creation atomic and immediate.** Child identity/medical data, `representante_id`, and initial `INACTIVA` membership belong to one transaction. Payment state is evaluated separately; rejection does not roll back the relationship.
4. **Keep reassignment out of self-service.** A duplicate identity lookup may return a safe stop/in-person-admin route, but it must not create a pending request or disclose the existing relationship. The admin operation atomically writes the replacement and its audit event.
5. **Make independence an admin identity transition.** Validate adulthood and in-person identity, allow debt, capture and verify the current email, create the account against the existing `persona_id`, revoke affected access, and audit the removal without deleting the person or medical history.
6. **Separate capability, account access, and player visibility.** A verified adult representative can have an empty dashboard; `ACTIVA` alone grants roster, scheduling, and attendance eligibility. Do not turn payment rejection into relationship removal or broad portal-access loss.
7. **Reuse access and notification primitives.** Session epochs/revocation and an available existing notification channel should be used where applicable. No new durable relationship approval/outbox model is justified by the confirmed contract.
8. **Treat legacy cleanup as a conservation-preserving migration.** Inventory incompatible dependent accounts, rehearse in QA/staging, revoke sessions, prove preserved identity/relationship/history counts and access invariants, then remove `Usuario`/role. Never auto-reuse or reserve retired email addresses.
9. **Retain database reachability safeguards.** Service and database constraints must continue to prevent active minors from becoming unreachable or being assigned to an inactive representative.

## Candidate implementation slices for later design/tasks

These are exploration boundaries, not approved tasks. They follow the canonical three-stage order; complementary contracts are listed afterward.

### Stage 1 — Immediate authenticated creation

- Replace public/client-selected child enrollment with session-derived authenticated enrollment.
- Remove child credential inputs and dependent `Usuario`/`ALUMNO` creation.
- Safely look up or reuse the child identity, then atomically create/update child data, `representante_id`, and `INACTIVA` membership.
- Keep payment handling separate: `APROBADO` activates membership; `RECHAZADO` preserves the relationship and `INACTIVA` membership.
- Provide the verified adult representative’s account-first empty dashboard without requiring a fabricated relationship state.

### Stage 2 — In-person-admin reassignment

- Replace self-service `vincular_representado` fallback with a safe stop that discloses no existing-person relationship.
- Add the in-person admin operation that atomically replaces `Persona.representante_id`.
- Extend/reuse append-only history for actor, date, origin, old representative, and new representative.
- Revoke the access affected by the replacement and use an existing notification channel after the committed operation.

### Stage 3 — In-person-admin independence

- Restrict the operation to an in-person administrator, require adulthood and identity verification, and allow debt.
- Capture and verify a current email, create `Usuario` with the unchanged `persona_id`, and revoke affected access.
- Remove the relationship without deleting person, medical, attendance, payment, or consent history.
- Record actor/date/origin/old/new audit evidence; do not leave a dependent self-service actor or invent an admin-account activation workflow.

### Complementary contracts

- **Access and visibility:** reconcile `REPRESENTANTE`, `ALUMNO`, membership projections, BFF identity handling, and the `ACTIVA` player gate without broadening the specified visibility loss.
- **Audit and notifications:** choose the compatible history schema/constraints and an available existing notification channel; keep notifications post-commit if that matches the existing mechanism, without adding a new durable approval/outbox contract.
- **Legacy account cleanup:** inventory, rehearse, revoke, conservation-check, and remove incompatible dependent accounts/roles, with explicit retired-email handling.
- **Regression coverage:** update backend, migration, frontend utility, and E2E tests for the three stages, payment rejection conservation, session revocation, active-minor reachability, and empty representative dashboard.

Each later work unit should remain under the 400 changed-line review budget where possible and include its focused tests. Delivery slicing is already configured as `auto-chain` with `feature-branch-chain`; the design/tasks phases must assign dependencies to the three stages rather than mixing them into an unbounded migration slice.

## Unresolved technical design choices

Product behavior is confirmed above. The following are the remaining implementation/design questions; none authorize a new product lifecycle or external research dependency.

1. Should the existing `VinculacionRepresentante` table be extended, or should a separate append-only relationship-event table hold creation, reassignment, and independence audit rows? In either case, what nullable old/new columns, actor reference, origin representation, indexes, and retention constraints are required?
2. What transaction locks, uniqueness constraints, idempotency keys, and retry behavior are needed so creation, reassignment, and independence cannot produce duplicate accounts, lost replacements, or an active minor without a reachable representative?
3. Which existing service/API boundary should perform in-person-admin authorization and identity-verification evidence, and how should the verified current email be handed to the existing account/verification machinery without reusing a retired address?
4. Which concrete session subjects and epoch records constitute “affected access” for reassignment and independence, and at what commit point should revocation become effective?
5. Which existing notification channel is available for each committed operation, and what best-effort/error handling preserves the operation when notification delivery fails without introducing a new durable relationship outbox?
6. How should the existing `ALUMNO` role and membership projections be reconciled so only `ACTIVA` drives player roster/scheduling/attendance visibility while account and representative capability access remain correctly available?
7. What inventory format, QA/staging rehearsal checks, conservation proof, and production ordering safely remove incompatible dependent `Usuario`/role records while preserving person and historical data?
8. What response and frontend-state contract should represent safe-stop reassignment, inactive/rejected-payment membership, and an empty representative dashboard without exposing relationship data or encoding relationship lifecycle state?

## Exploration conclusion

The repository has reusable primitives—verified-email machinery, session epochs, transactional service patterns, BFF boundaries, append-only relationship history, and minor-reachability database triggers—but its current public child enrollment, self-service reassignment, lazy role assignment, and pending dashboard encode an earlier model. The design should implement the confirmed three stages in order: immediate authenticated creation, in-person-admin atomic reassignment, and in-person-admin independence. Payment states remain membership concerns, `Persona.representante_id` remains the only current relationship projection, and audit/access/notification/migration work should complement those stages without creating a relationship approval state machine or an invented admin-account activation flow.
