# Technical design — represented-person account flow

## Decision

Keep `Persona.representante_id` as the only mutable representation state. Add one focused relationship application service, extend the existing append-only `vinculacion_representante` evidence table, and reuse existing session-epoch and in-app notification mechanisms. No relationship request/status table, second current-state projection, or relationship-notification outbox is introduced.

The implementation is delivered as seven chained slices: audit/idempotency foundation, credential/capability primitives, administrator independence cutover, relationship integrity and reassignment, account-first and represented-minor enrollment, active-player truth with frontend experience, and legacy remediation last. Safe independence always precedes removal of represented credentials. The existing public enrollment remains only for adult self-enrollment; it must no longer be a child-entry path.

## Ownership and invariants

| Concern | Authoritative owner | Rule |
|---|---|---|
| Current relationship and person-scoped representative authorization | `Persona.representante_id` plus `PoliticaAccesoPersona` | History never authorizes access. |
| Relationship mutation validation | new `RelacionRepresentacionServicio` in `backend/app/servicios_negocio/` | Its three commands are create, admin reassign, and admin independence; no other service writes `representante_id`. |
| Relationship persistence/locking | `PersonaRepositorio` additions | Locked reads are repository concerns; commit boundaries remain in the use case. |
| Relationship database defense | new Alembic migration after `g1139repmenor` | Database rejects self-links, cycles, adult new/re-links, invalid destination phones, and unsafe active-minor reachability even when services are bypassed. |
| Player eligibility | `MembresiaServicio.es_jugador_activo(persona_id)` and a composable repository `ACTIVA` predicate | `Membresia.estado == ACTIVA` is the sole criterion; roles and links are irrelevant. |
| Role/capability | `RolServicio` plus a shared account-capability core | `REPRESENTANTE` is a persisted portal capability, never player eligibility. The session reads that one technical role, never link count. Account-first registration grants it deliberately; account establishment for a person who already has dependents grants it atomically after a locked count. |
| Identity credentials | transaction-safe account cores extracted from the supported public enrollment/auth primitives | The account-first core creates an adult `Persona` and its one `Usuario`; the existing-person core creates or updates only that `Usuario`. Both invoke the shared representative-capability rule, email-verification primitive, and never use the retired `AdminCuentaServicio`. Neither emits tokens inside a relationship transaction. |
| Operational emergency contact | `FichaMedicaServicio` read projection | A represented minor projects the current representative name/phone; legacy minor fields remain stored but are never operational. |

`PersonaServicio` retains generic person CRUD but delegates every change to `representante_id` to `RelacionRepresentacionServicio`. Direct DTO-to-ORM writes of that column are removed. `PoliticaAccesoPersona` continues to read the current column live, which makes an old representative fail authorization even before token expiry.

## Relationship service contract

`RelacionRepresentacionServicio` exposes only these application commands:

1. `crear_desde_sesion(actor_persona_id, datos, idempotency_key)` — authenticated representative creation; actor and destination are derived server-side.
2. `reasignar_presencial(admin_actor_id, persona_id, nuevo_representante_id, evidencia_identidad, idempotency_key)` — administrator-only replacement.
3. `independizar_presencial(admin_actor_id, persona_id, credencial_actual, evidencia_identidad, idempotency_key)` — administrator-only adult exit that establishes verified credentials and the sole `REPRESENTANTE` technical capability on the unchanged person before unlinking; it creates no Persona and emits no token.
4. `retirar_capacidad_representante(admin_actor_id, persona_id)` remains in `RolServicio`, but uses the relationship repository count under lock before removing the role.

A shared internal validator receives locked `Persona` rows and checks, in this order: target exists and is active where required; proposed relation actually changes; no self-link; target is currently under 18 for create/reassign; destination is an eligible adult, active/reachable, with a valid current phone; and no ancestry cycle. Removal uses the same validator in removal mode: it permits only a current adult target and forbids minor unlinking. Debt is intentionally not read by independence.

The service is the user-facing error path; database errors are mapped to the same domain errors after rollback. The database remains authoritative against raw SQL or future bypasses.

## PostgreSQL safeguards

### Constraints and triggers

The migration adds:

- `ck_persona_representante_no_autoreferencia CHECK (representante_id IS NULL OR representante_id <> id)`. It is `NOT VALID` initially, then validated only after the remediation inventory proves no existing self-link. The operational runbook does not permit a production validation until that evidence is approved.
- A `BEFORE INSERT OR UPDATE OF representante_id ON persona` relationship trigger. It immediately returns when an update did not change the value. On a non-null new link it rejects a target aged 18 or older at the club date, locks the relationship graph mutex with `pg_advisory_xact_lock(<documented fixed key>)`, locks the destination `usuario` row when present, checks destination reachability/phone, and uses a recursive CTE following `representante_id` from the proposed destination to reject a path back to `NEW.id`.
- The existing active-minor reachability trigger is replaced by the same scoped relationship trigger behavior: clearing a changed link is rejected only if `NEW.activo` is true and the target is currently under 18. The existing `usuario.activo` trigger remains and continues to block deactivation of a representative with active minor dependents.
- A `BEFORE UPDATE OF telefono ON persona` destination safeguard: a representative cannot change their phone to an invalid value while they have active minor dependents. It does not run for unrelated fields. The SQL phone predicate is the canonical `^(09[0-9]{8}|0[0-9]{8})$`, matching `_RE_TELEFONO_FORMA`.

The relationship trigger is intentionally scoped to `INSERT` and `UPDATE OF representante_id`, with `IS NOT DISTINCT FROM` short-circuiting. Therefore a represented adult who reached 18 while linked can edit name, address, medical data, or other unrelated fields; can clear the unchanged old link through the authorized adult-independence path; but cannot be newly linked or re-linked as an adult. The trigger never reevaluates an existing relationship merely because time passes.

The graph-wide transaction advisory lock is deliberate defense for raw SQL: row locks on only the two endpoints cannot prevent three concurrent updates from forming a longer cycle. Application commands additionally take predictable row locks for correctness and helpful conflict behavior; the trigger mutex is the final serializing database boundary, not a second source of state.

## Transaction, locking, uniqueness, and retry policy

All domain writes use one SQLAlchemy transaction and exactly one successful `commit()`. Repositories only add/flush.

| Operation | Lock order and transaction | Uniqueness/idempotency | Commit and retry result |
|---|---|---|---|
| Account-first adult registration | Validate no existing identity/account, then lock the normalized-email slot; create the adult Persona, Usuario, role association, consent rows, verification-outbox row, and dedicated `registro_representante_idempotencia` receipt in one transaction. | `Idempotency-Key` is required; the dedicated receipt is unique by key and stores SHA-256 over normalized adult identity/contact, email, document versions, and command version. Persona identity and normalized email remain database backstops. | Same key/fingerprint returns the original `verificationRequired` outcome without another outbox event; same key/different fingerprint is 409. Any failure rolls back all account, role, consent, outbox, and receipt rows. |
| Session-derived creation | Lock verified session representative `Persona` and `Usuario`, then any safely reusable target `Persona`, in ascending `persona.id`; lock the selected membership type and the new membership/payment slot. A new target is inserted only after identity lookup. | Require `Idempotency-Key`; the creation audit event is the replay receipt, globally unique by key, with a canonical SHA-256 fingerprint over the derived actor, normalized child identity, allowed person/medical data, selected plan, initial-payment fields, consent-document versions, and command version. `persona.cedula` and the existing pending-payment constraint are database backstops. The locked reusable target must have no `Usuario`, no current relationship, and no existing membership; otherwise return the same non-disclosing stop. | Persona/reused identity, medical record, all current legal-consent snapshots, `representante_id`, complete relationship audit event, exactly one `INACTIVA` membership, and exactly one linked `PENDIENTE_VALIDACION` payment commit together. Same key/fingerprint returns the saved IDs/states; same key/different fingerprint is 409; an identity or pending-payment race rolls back and returns the safe stop, never a second membership or payment. |
| Admin reassignment | Lock represented person, old representative, new representative, and their `Usuario` rows in ascending person id. The DB graph mutex serializes concurrent graph writes. | Required idempotency key/fingerprint on the audit event. The command also carries the caller's observed current representative ID; a mismatch is 409 unless an existing event for the same key/fingerprint proves completion. | Relationship replacement and evidence are flushed then committed atomically. The losing distinct reassignment sees conflict and cannot overwrite newer state. |
| Admin independence | Lock target, old representative, and target/old `Usuario` plus target role rows in ascending person id. Create or update credentials and establish/reuse/explicitly replace the sole `REPRESENTANTE` role against the locked target `persona_id` before clearing the relation. | Required idempotency key/fingerprint; one `Usuario.persona_id`, normalized email uniqueness, and #762's single-role trigger are database backstops. | Credential/capability establishment, old-link removal, complete audit, and required session epochs commit together. Retry returns completed outcome, never another user, second role, or event. |
| Payment validation | Preserve existing `PagoServicio.validar_pago` `FOR UPDATE` behavior. | Existing pending-payment/database uniqueness remains authoritative. | `APROBADO` activates only that membership; `RECHAZADO` writes only payment verdict and preserves relationship plus `INACTIVA` membership. |
| Remediation batch | Lock candidate `Persona`, `Usuario`, role association rows, direct represented-person rows, and candidate audit/idempotency evidence in ascending person id. Re-check against signed inventory snapshots while locked. | Each batch has immutable batch id plus candidate fingerprint and a unique `(batch_id, usuario_id)` receipt. | A committed receipt makes a retry report completed; any changed candidate stops that candidate for fresh inventory. |

All explicit row-lock reads use the existing bounded lock-timeout helper and become the existing concurrency conflict response, not an unbounded wait. `IntegrityError`, stale observed-state conflict, and lock timeout always roll back before retry/reload. Notifications and session effects do not occur before the main commit.

## Audit schema evolution

Extend, rather than replace, `vinculacion_representante`; it remains an event ledger and never gains a `current`, `pending`, or approval column.

| Column | Evolution | Meaning |
|---|---|---|
| `id`, `persona_id`, `fecha` | retain | immutable event identifier, represented person, and server timestamp. |
| `representante_anterior_id` | retain nullable | null only for creation. |
| `representante_nuevo_id` | change to nullable | null only for independence/removal. |
| `actor_persona_id` | add FK `persona.id`, `NOT NULL` after backfill | authenticated representative for session creation or authorized administrator for in-person operations. |
| `operacion` | add `VARCHAR(24) NOT NULL` with check `CREACION`, `REASIGNACION`, `INDEPENDENCIA` | event semantics, not relationship state. |
| `origen` | add `VARCHAR(32) NOT NULL` with check `SESION_AUTENTICADA`, `ADMIN_PRESENCIAL`, `AUTOSERVICIO_LEGADO`, `REMEDIACION_LEGACY` | route/origin evidence. |
| `idempotency_key` | add nullable `VARCHAR(64)` unique where non-null | command replay identity. |
| `request_fingerprint` | add nullable `CHAR(64)` | canonical command hash; required with every non-null key. |

Add check constraints: old and new representatives differ when both exist; operation/value nullability matches the table above; and `idempotency_key` and fingerprint are either both null or both non-null. Add indexes on `(persona_id, fecha DESC, id DESC)`, `actor_persona_id`, and `idempotency_key`.

Migration backfill sets prior rows to `actor_persona_id = representante_nuevo_id`, `operacion = REASIGNACION`, and `origen = AUTOSERVICIO_LEGADO`; this is accurate for the current self-service event writer. It then makes actor/origin/operation non-null and permits `representante_nuevo_id` null for future independence. No old row is rewritten later. New events always contain actor, date, origin, old value, and new value, with the documented null appropriate to create/removal.

## Identity, sessions, notifications, and capability

### Account-first adult representative — #1134

Add the public, rate-limited `POST /representante/cuenta` use case, backed by `CuentaRepresentanteServicio.registrar_autoservicio`. Its DTO accepts an eligible adult's identity/contact fields, email/password, and affirmative acceptance of the current legal documents; it has no `representante_id`, represented-person, membership-plan, payment, or role field. It requires an `Idempotency-Key` and reuses the public enrollment identity validation, password hashing, normalized-email uniqueness, legal-consent core, and `VerificacionCorreoOutbox` primitive. It does **not** reuse `AdminCuentaServicio`, which is retired and intentionally empty.

One transaction persists the new adult `Persona`, its one active `Usuario` with `correo_verificado=False`, the sole `REPRESENTANTE` association, and the complete current legal-consent snapshots for that account; it then enqueues the existing verification-email outbox record before the single commit. The account-creation idempotency receipt fingerprints normalized identity, contact data, normalized email, accepted document versions, and command version. Any duplicate identity/email, role insert, consent, outbox, or receipt failure rolls the entire account creation back. The registration response is `201 { persona: { id }, verificationRequired: true }` and contains no token. The existing public `POST /auth/verificar-correo` confirmation remains the only email-proof step; after successful confirmation the adult performs the normal login, receives a standard one-role session, and `/student` renders the empty representative dashboard. Thus an unverified browser never receives portal authority merely by registering. The existing-person `POST /auth/registro` path is refactored to call the same existing-person account/capability core: when its locked `Persona` already has one or more dependents, its newly created account receives the sole persisted `REPRESENTANTE` role before commit. This closes the later-account path without making link count a runtime session role.

Extract the non-committing account/person, credential, capability, and consent helpers from `EnrollmentServicio`/`AuthServicio` so account-first registration and the existing-person path share validation and one-commit discipline. The legacy public enrollment endpoint retains only the adult player self-enrollment path until its child branch is removed; it must not become a second representative-account writer.

### Independence credentials

Extract a non-committing `AuthServicio` existing-person core that establishes credentials only for an already locked `persona_id`. It accepts current email, password, and the in-person verified-email assertion supplied by the admin command. It creates a `Usuario` on that unchanged person with `correo_verificado=True`, or updates an existing legacy user on that person. It then establishes the sole `REPRESENTANTE` capability through the shared account-capability core; it never assigns `ALUMNO`, emits a token, creates a `Persona`, or uses the retired `AdminCuentaServicio`.

The existing in-person administrator boundary is the verification boundary: email is marked verified only after staff confirm the adult's identity and current email in person. Normalized-email uniqueness is checked while locked and enforced by `ix_usuario_correo_lower`. If a different person's account owns the email, the complete transition fails without unlinking. A pre-existing target user has its session epoch incremented because credentials/email and/or its legal role changed.

The shared capability rule preserves #762 deterministically. It locks the `Usuario` and its `usuario_rol` rows: no current role inserts `REPRESENTANTE`; an existing sole `REPRESENTANTE` is reused; an existing sole non-`REPRESENTANTE` legal role is explicitly replaced in the same transaction (remove that one association, append `REPRESENTANTE`, and record the in-person admin actor in the operation audit); and a legacy multi-role account is rejected for owner-selected legacy-role remediation, never guessed or silently rewritten. The database trigger remains installed on every inserted association, so no path can append a second role. The replacement occurs only in this administrator-authorized independence transition; it is not a generic self-service role conversion.

### Exact session subjects

- **Reassignment:** increment `version_sesion` for the former representative's `Usuario` only. The new representative receives access from the newly committed current relationship; no revocation is needed for a grant. The represented person has no new credential in this flow.
- **Independence:** increment the former representative's epoch; also increment the target's epoch if a legacy `Usuario` was updated for credentials, email, or deterministic role replacement. A newly created target user has no pre-existing token to revoke.
- **Representative capability removal:** increment the capability holder's epoch after role removal, only after the zero-current-link check and role deletion commit.
- **Legacy remediation:** increment every removed dependent user's epoch in the same batch transaction before deletion, and verify no valid epoch-bearing account remains for that user. The former representative is not revoked merely because a dependent's incompatible account is removed.

Epoch increments are persisted with the main command. Because authorization reads `representante_id` live, access is denied immediately after commit even if a stale cache exists; the epoch closes access and refresh-token reuse. No session event is sent before commit.

After commit, the request process best-effort creates the existing in-app `Notificacion` for the former representative on reassignment/independence, using neutral copy that does not disclose protected details beyond the recipient's prior relationship. It logs structured operation id and recipient on failure, rolls back only the notification's separate transaction, and returns the already committed domain outcome. No durable relationship outbox is added. There is no notification requirement for creation.

### Representative account and capability

A verified eligible adult with the sole `REPRESENTANTE` role enters `/student` with zero links and receives the dedicated empty representative dashboard. The response carries server-derived `capabilities.representante` from the persisted single role; the frontend must not infer capability from `representados.length`. Per-person data still requires the live current link.

The shared account-capability core also runs whenever a `Usuario` is first established for an existing `Persona`. It locks/counts `Persona.representante_id == persona_id` in the same transaction. If that count is positive, it assigns/reuses the sole `REPRESENTANTE` role using the #762 rule above; a person who already has dependents can therefore never gain a usable account without representative capability. This is a one-time persisted grant decision, not a runtime inference from a link. If the count is zero, generic account creation retains its explicitly selected supported account contract; the #1134 account-first endpoint nevertheless selects `REPRESENTANTE` deliberately even with zero links.

`RolServicio.quitar_rol(..., REPRESENTANTE)` is administrator-only and first locks/counts current links; it rejects nonzero links, otherwise removes only that role and revokes the holder's sessions. Removal remains the only way to withdraw this capability and must never occur from a payment, membership, verification, or relationship transition. Payment and membership transitions never remove it.

## Membership player truth

`MembresiaServicio.es_jugador_activo` delegates to `MembresiaRepositorio.existe_activa_por_persona`, whose SQL predicate is exactly `Membresia.estado == EstadoMembresia.ACTIVA` (and active person where the existing operational surface already requires it). The repository also exposes this predicate as a join/subquery so roster projections remain set-based rather than N+1.

Apply that predicate to member roster, group/schedule assignment and listing, and attendance eligibility/registration. Existing historical `AlumnoHorario` and attendance records are preserved; inactive members are filtered from operational rosters and rejected for new scheduling/attendance. Frontend members, dashboard, and portal consume an authoritative `isActivePlayer`/membership-state field from the BFF and never inspect roles or represented links for player status.

Remove the lazy `ALUMNO` assignment and role-conflict gate from `MembresiaServicio.crear_membresia`. Existing `ALUMNO` data is not player authority and is handled only by the later incompatible-account inventory where applicable. A representative with `REPRESENTANTE` and an `ACTIVA` membership is therefore a player without `ALUMNO`; a representative with no active membership keeps account/capability access but is not a player.

## API and BFF contract

### Account-first adult representative — #1134

`POST /representante/cuenta` is the sole public self-service account-first endpoint. Its BFF proxy, `POST /api/representante/cuenta`, forwards only adult identity/contact, credentials, legal acceptance, and the required `Idempotency-Key`; it never accepts a relationship, membership, payment, actor, or role selector. It responds `201 { persona: { id }, verificationRequired: true }` without cookies/tokens. It reuses `/auth/verificar-correo` and normal login rather than introducing an account-activation service. After verification and login, `GET /api/student` returns `capabilities.representante: true`, `representados: []`, no membership/player access, and the empty representative dashboard.

### Session-derived child enrollment

Replace `POST /personas/{persona_id}/representados` as the representative-facing command with `POST /representados` (authenticated, verified, sole-role `REPRESENTANTE`; administrator is not a browser-supplied substitute). The body contains only allowed represented-person data, `membership: { tipo_membresia_id }`, `initialPayment: { meses, tipo_pago }`, full affirmative legal-consent acceptance, and the required medical record; it contains no representative identifier, dependent credentials, role, membership state, payment state, amount, coverage dates, or validation actor. The server derives `actor_persona_id` and the actor `usuario_id` from the verified session. `Idempotency-Key` is required and forwarded unchanged by the BFF.

`POST /api/representados` forwards only this body and session; it never accepts a path/query/body representative id. Success returns `{ persona, membership: { id, estado: "INACTIVA", isActivePlayer: false }, payment: { id, estadoPago: "PENDIENTE_VALIDACION", membresiaId, monto, meses, tipoPago, fechaInicio, fechaFin }, legalConsents: { documentIds, version } }`. It returns neither a dependent `Usuario` nor a token. A duplicate, ambiguous, protected, already-linked identity, stale/pending payment conflict, or prohibited input returns one non-disclosing `409 { code: "ADMIN_ASSISTANCE_REQUIRED", message: "No se pudo completar esta inscripción en línea. Acérquese a administración." }` when disclosure would reveal identity/link state; ordinary syntactic field validation remains 422. The UI stops and routes to the in-person instruction, with no request/pending relationship record.

The service invokes no-commit cores in this order after all DTO validation: create/reuse persona; create medical record; write current `Persona.representante_id`; append the complete creation audit; create the one `INACTIVA` membership from the locked plan; create its one `PENDIENTE_VALIDACION` payment with server-derived financial snapshots/coverage; and record all legal consents for `cuenta_id=actor_usuario_id, representado_persona_id=child`. Every failure before the one commit—including payment/consent/audit insert or database uniqueness/trigger failure—calls `rollback()` and returns no new Persona, link, medical record, audit, consent, membership, or payment. No relationship notification outbox is added.

The old self-service `vincular-representado` endpoint/BFF is removed or replaced by this same safe-stop response; it cannot mutate a relationship. Admin reassignment and independence are administrator routes, not portal/BFF routes, and require the in-person evidence payload plus idempotency key.

`GET /api/student` stops requiring browser `personaId`. It derives the session person, returns only backend-authorized self/current dependents, includes `capabilities.representante`, `isActivePlayer`, and current membership/payment status, and rejects any supplied `personaId` rather than treating it as authority. The account-first empty dashboard is selected from capability with zero links, independently of `ALUMNO`.

### #1138 DTO/data/form matrix

| Surface | Represented minor write behavior | Representative/contact behavior | Read behavior |
|---|---|---|---|
| `RepresentadoCreateDTO` / authenticated enrollment DTO | Explicitly declares `telefono`, `institucion_id`, `correo`, `contrasenia`, `ficha_medica.contacto_emergencia`, and `ficha_medica.telefono_emergencia` as forbidden-for-minor fields; `model_fields_set` rejects any presence, including `null`, empty, or value. | Service locks and validates representative current phone before link. | Returns allowed person data only. |
| Generic `PersonaCreateDTO` / `PersonaUpdateDTO` | Service checks whether the resulting person is represented and under 18; presence of personal phone/school fields is rejected before any flush. | Cannot alter `representante_id` through these DTOs. | Legacy stored phone/school is omitted/marked non-operational for represented-minor projections. |
| `FichaMedicaCreateDTO` / `FichaMedicaUpdateDTO` | Service rejects free-text emergency fields for represented minors, including explicit null in a patch. | Adult without a representative must provide valid emergency name and phone; normal phone validation remains authoritative. | Emergency DTO derives current representative name/phone for a represented minor and ignores stored legacy values. |
| Enrollment/public DTOs and BFF mappers | Public child branch and child credentials are deleted; any deprecated child credential or prohibited field is explicitly rejected, not discarded. | BFF forwards no actor/representative authority. | Server errors pass through unchanged. |
| React forms/types | Remove minor phone, school, credential, and free-text emergency controls, validation, summary, and payload mapping. | Representative phone is validated before submit and revalidated server/database side. | Display derived contact, never legacy minor values. |

All rejection happens before mutations, so a payload with one forbidden field cannot partially create a person, membership, medical row, or audit event. Adult emergency requirements remain unchanged for unrepresented adults. Legacy values require no destructive migration and are retained solely for compatibility/history.

## Migration and remediation design

### Migration inventory

Schema migrations are additive/contract-preserving: audit extension; self/cycle/age/phone triggers; relation/repository indexes; and any BFF DTO code. Before enforcement validation or destructive remediation, a read-only inventory records stable IDs and checksums for every incompatible dependent `Usuario` and role record, plus affected `persona_id`, email normalization, role ids, session epoch, current representative, memberships, payments, medical record, attendance, consent, and relationship-audit ids.

The inventory is a versioned, signed artifact stored outside application current-state tables, with a source database snapshot identifier, query revision, timestamp, candidate count, and per-candidate fingerprint. It does not reserve retired emails or grant authorization.

### Rehearsal, batch, and conservation

1. Deploy and validate the independence exit, entry-path closure, relationship safeguards, and safe empty representative dashboard before inventory approval.
2. Generate inventory in QA/staging representative data; execute the exact batch script there; prove the restoration procedure from the pre-batch snapshot.
3. Compare per-candidate identities and aggregate/count/hash conservation for people, current `representante_id`, memberships, payments, medical data, attendance, consent, and relationship audit. Re-run active-minor reachability and zero unintended-user/role assertions.
4. On an approved production window, regenerate inventory. Any snapshot/candidate/fingerprint drift, failed rehearsal, missing restoration evidence, revocation failure, or conservation mismatch is a hard stop before the first delete.
5. For an eligible locked batch, revoke epochs, delete only inventoried incompatible `Usuario` and role rows, write a batch receipt, run conservation/reachability checks in the transaction where possible, and commit. Reconcile post-commit against receipt. There is no production execution in this change/design.

Rollback before commit is transaction rollback. After a committed destructive batch, restore only the tested pre-batch account/role records from the protected backup and use the receipt to reconcile; never delete preserved domain records as rollback. Application behavior can be reverted independently before remediation begins.

## Sequences

### Child enrollment

```mermaid
sequenceDiagram
  actor R as Representative browser
  participant B as Next BFF
  participant A as FastAPI
  participant S as RelacionRepresentacionServicio
  participant DB as PostgreSQL
  R->>B: POST /api/representados + Idempotency-Key + allowed data
  B->>A: authenticated POST /representados (no representative id)
  A->>S: actor from verified session
  S->>DB: lock verified actor/account, target, plan and payment slot; validate phone, age, graph
  alt safe identity reuse/new identity
    S->>DB: Persona + medical + representante_id + complete audit + legal consents + INACTIVA membership + PENDIENTE_VALIDACION payment
    S->>DB: COMMIT
    A-->>B: 201 person + inactive membership + pending payment + consent receipt
    B-->>R: 201; no dependent credential/token
  else ambiguous/protected/duplicate identity
    S-->>A: non-disclosing safe stop
    A-->>B: 409 ADMIN_ASSISTANCE_REQUIRED
    B-->>R: same safe stop
  end
```

### Account-first adult registration and verification

```mermaid
sequenceDiagram
  actor Adult as Adult browser
  participant B as Next BFF
  participant A as FastAPI
  participant C as CuentaRepresentanteServicio
  participant DB as PostgreSQL
  participant V as Existing verification worker
  Adult->>B: POST /api/representante/cuenta + Idempotency-Key
  B->>A: allowed adult data, credentials, consent acceptance
  A->>C: validate eligible adult; no role/link/membership input
  C->>DB: Persona + Usuario(unverified) + sole REPRESENTANTE + consents + verification outbox
  C->>DB: COMMIT
  A-->>B: 201 verificationRequired; no tokens
  V->>Adult: existing verification email
  Adult->>A: POST /auth/verificar-correo with existing token
  A->>DB: mark correo_verificado; COMMIT
  Adult->>B: normal login then GET /api/student
  B-->>Adult: one-role REPRESENTANTE session; empty dashboard
```

### Administrator reassignment

```mermaid
sequenceDiagram
  actor Admin as In-person administrator
  participant A as Admin API
  participant S as Relationship service
  participant DB as PostgreSQL
  participant N as Existing notification service
  Admin->>A: reassignment + identity evidence + Idempotency-Key
  A->>S: admin subject from token
  S->>DB: lock target, old/new representatives and accounts
  S->>DB: validate shared invariants; replace representante_id; append audit
  S->>DB: increment old representative session epoch; COMMIT
  S-->>A: committed result
  A->>N: best-effort notify former representative after commit
  N-->>A: delivered or logged failure
  A-->>Admin: committed result
```

### Administrator independence

```mermaid
sequenceDiagram
  actor Admin as In-person administrator
  participant A as Admin API
  participant S as Relationship service
  participant I as Auth credential core
  participant DB as PostgreSQL
  participant N as Existing notification service
  Admin->>A: adult identity evidence + current email/password + key
  A->>S: authorized admin subject
  S->>DB: lock adult, former representative, account rows
  S->>I: establish verified credentials + sole REPRESENTANTE on unchanged persona_id
  I->>DB: create/update Usuario; apply #762 role rule; no Persona and no token
  S->>DB: clear representative_id; complete audit; revoke former/updated-user epochs
  S->>DB: COMMIT
  A->>N: best-effort post-commit former-representative notice
  A-->>Admin: adult independent; preserved persona/history
```

### Payment approval/rejection

```mermaid
sequenceDiagram
  actor Admin as Payment administrator
  participant P as PagoServicio
  participant DB as PostgreSQL
  Admin->>P: validate pending payment
  P->>DB: lock Pago
  alt approved
    P->>DB: set Pago APROBADO; set linked Membresia ACTIVA; COMMIT
    P-->>Admin: player eligibility now true
  else rejected
    P->>DB: set Pago RECHAZADO only; COMMIT
    P-->>Admin: relationship and INACTIVA membership preserved
  end
```

### Remediation gate

```mermaid
sequenceDiagram
  participant O as Operator
  participant G as Remediation gate
  participant Q as QA/Staging rehearsal
  participant DB as Production database
  O->>G: submit inventory + restoration + revocation + conservation evidence
  G->>Q: verify exact rehearsal
  alt all evidence current and successful
    G-->>O: eligible to schedule, not execute automatically
    O->>DB: regenerate inventory; lock batch; recheck fingerprints
    alt unchanged
      DB-->>O: eligible batch transaction / receipt design
    else changed
      DB-->>O: stop; fresh inventory required
    end
  else evidence missing or failed
    G-->>O: stop before credential/role write
  end
```

## File-level implementation map

| Area | Planned change |
|---|---|
| `backend/app/servicios_negocio/relacion_representacion_servicio.py` | New focused command/validation/orchestration service. |
| `backend/app/servicios_negocio/cuenta_representante_servicio.py`, `auth_servicio.py`, `rol_servicio.py`, `enrollment_servicio.py`, `persona_servicio.py` | Add account-first adult registration and shared no-commit account/capability/verification/consent cores from supported enrollment/auth paths; remove legacy relationship/self-service/independence behavior; delegate relationship changes; add automatic dependent-count capability grant and zero-link-only capability removal. |
| `backend/app/infraestructura/repositorios/persona_repositorio.py`, `usuario_ficha_repositorio.py`, `membresia_repositorio.py` | Locked reads, live-link counts, active-player predicate, identity lookup support. |
| `backend/app/dominio/modelos.py` and Alembic migration | Audit columns/indexes/checks; `registro_representante_idempotencia` receipt; PostgreSQL constraints/triggers; no alternate relationship model. |
| `backend/app/servicios_negocio/membresia_pago_servicio.py`, `asistencia_servicio.py`, roster/scheduling repositories | Remove role-as-player gates; consume the `ACTIVA` predicate. |
| DTOs and routers under `backend/app/servicios_negocio/dtos/` and `backend/app/presentacion/routers/` | New account-first adult registration/verification contract and authenticated/admin commands; initial payment/consent response; explicit prohibited fields and safe-stop response; remove public child flow. |
| `frontend/src/app/api/student/route.ts`, new `/api/representante/cuenta` and `/api/representados`, student/dependent forms and adapters | Account-first registration/verification handoff and session-derived BFF, capability/member projections, empty representative dashboard, removed forbidden inputs. |
| Tests and remediation scripts/runbook | Transaction/trigger concurrency, API non-disclosure, projection parity, migration rehearsal/conservation receipts. |

## Validation plan

- Unit-test shared relationship validation, current-age behavior, canonical idempotency fingerprints (including child medical/plan/payment/consent inputs), capability zero-link removal, automatic dependent-count grants, #762 single-role outcomes, and the `ACTIVA` predicate without roles.
- Test account-first registration: adult Persona + unverified Usuario + exactly one `REPRESENTANTE` + legal consents + verification outbox atomically commit; duplicate/replay behavior; email confirmation followed by normal one-role login and empty dashboard; no membership/link/token at registration; and no `AdminCuentaServicio` call.
- Run PostgreSQL migration tests for direct self-link, two- and three-node cycles, direct adult re-link, adult aged-in-place unrelated update/unlink, invalid representative phone, minor reachability under concurrent account/relationship changes, and the unchanged #762 trigger on every new account/capability path.
- Test each command transactionally: complete audit co-commit, child creation rollback on medical/consent/audit/membership/payment failure with zero residual records, stale reassignment conflict, retry completion, exact session epochs, deterministic independence role replacement/rejection of legacy multi-role accounts, and post-commit notification failure.
- Test every #1138 DTO/BFF matrix cell with omitted vs explicit `null`, empty, and populated prohibited fields; assert no partial write and derived emergency contact ignores legacy values.
- Test child-enrollment response/API non-disclosure and assert it contains one `INACTIVA` membership, one linked `PENDIENTE_VALIDACION` payment, and consent receipt but no dependent credential/token. Test payment approval activates only that payment's linked membership; rejection changes only the payment verdict and preserves the relationship, membership, medical record, audit, and consents. Cover active/inactive player behavior across roster, schedule assignment/listing, attendance, portal, dashboard, and representative-without-`ALUMNO` cases.
- Rehearse remediation only in QA/staging with the stated inventory, restoration, reachability, and conservation proofs. Production remediation is explicitly out of scope for this change.

## Feature-branch-chain and rollback boundaries

Use the configured feature-branch chain with the draft/no-merge tracker #1164. Each PR targets its immediate predecessor and carries tests/docs for its work unit. The earlier 10-slice/400-line chain map is superseded by the seven-slice replan: each slice targets 600–900 additions plus deletions with a hard stop at 1,000; a slice that cannot land at or below 1,000 stops and is re-sliced, with no routine size exceptions.

```text
main
  └─ tracker #1164: represented-person-account-flow
       └─ 1 audit/idempotency foundation (#1165, open)
            └─ 2 existing-person credential + REPRESENTANTE capability primitives
                 └─ 3 administrator independence vertical cutover
                      └─ 4 relationship integrity and admin reassignment
                           └─ 5 account-first representative + represented-minor enrollment
                                └─ 6 ACTIVA player truth and frontend experience
                                     └─ 7 legacy remediation and final E2E
```

Rollback is per PR against its immediate parent. Slices 1–6 are application/schema behavior reversions that preserve person, membership, payment, medical, attendance, consent, and audit records. Trigger/audit schema downgrade is allowed only before any dependent later slice relies on it and only with a tested backup. Slice 7 does not execute production removals; any future remediation rollback uses its tested backup/receipt restoration boundary, not deletion of conserved records.

## Key decisions checklist

- [x] One mutable relationship projection: `Persona.representante_id`.
- [x] Relationship validation has one service owner and PostgreSQL defense.
- [x] `ACTIVA` is the sole player predicate, independent of `ALUMNO` and `REPRESENTANTE`.
- [x] Audit is append-only evidence with actor/date/origin/old/new values.
- [x] Reassignment and independence atomically commit state, audit, and session epochs; notifications are post-commit best effort.
- [x] Account-first registration uses supported public enrollment/auth primitives to create a verified adult `REPRESENTANTE` account and empty dashboard without a membership or link.
- [x] Independence retains the exact persona, creates no Persona/token, and uses verified in-person credentials plus the sole `REPRESENTANTE` capability without an admin identity-minting flow.
- [x] Every new account/capability path preserves #762: it takes the existing per-user role lock/trigger path, persists/reuses only `REPRESENTANTE` (never `ALUMNO`), and never appends a second role; the sole non-`REPRESENTANTE` replacement is the explicit in-person independence rule.
- [x] Child enrollment derives authority from session, atomically records Persona, relationship, complete audit, medical record, consents, one inactive membership, and one pending payment, and stops ambiguities without disclosure.
- [x] No request state or durable relationship notification outbox is introduced.
- [x] Remediation is gated, rehearsed, conservation-preserving, and not executed in production by this change.
