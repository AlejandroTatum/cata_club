# Represented-person account flow

## Intent

Deliver the represented-person flow with the canonical ownership and safety order from **#1137**: first provide an administrator-run independence exit for an existing person; next close every invalid credential/entry path and enforce the relationship, account, membership, and minor-contact invariants; only then remediate incompatible existing accounts. This order prevents credential removal from stranding people without a safe transition.

Product decisions are confirmed, external research remains unselected, and `Persona.representante_id` remains the sole current relationship state. This proposal does not introduce relationship requests, approval states, or a parallel relationship projection.

## Canonical issue ownership

| Issue | Owned contract |
|---|---|
| **#1137** | The complete represented-person flow, migration/remediation safety, and the implementation order stated above. |
| **#1132** | `Membresia.estado = ACTIVA` as the sole player truth across backend roster, scheduling, and attendance, plus frontend member/dashboard/portal derivation. A `REPRESENTANTE` can play without an `ALUMNO` role. |
| **#1133** | Creation, change, and removal of representation: unified relationship validation; database anti-self/cycle safeguards; administrator-only atomic reassignment; minor-no-unlink rule; complete audit; access revocation; and notifications. |
| **#1134** | The pre-existing adult representative account, its empty dashboard, and `REPRESENTANTE` capability semantics. It does **not** own independence. |
| **#1135** | A superseded decision only; no implementation or closure work is planned. |
| **#1138** | Minor fields and representative-derived operational emergency contact, including explicit API rejection of prohibited minor fields. It is not legacy-account cleanup. |

## Scope

### 1. Independence exit first — #1137, using #1133 relationship safeguards

- Provide an in-person, administrator-authorized transition for an adult who is currently represented.
- Verify identity and a current email, create the adult `Usuario` against the unchanged `persona_id`, and remove the representation without deleting the person or their medical, attendance, payment, consent, or audit history.
- Debt does not block independence. Minors cannot be unlinked; the database and service layer must preserve that rule.
- Apply the #1133 audit, affected-access revocation, and notification requirements to the transition.

### 2. Close invalid entry paths and enforce the target contracts

#### Adult account and capability — #1134

- Establish the adult representative account before represented-person operations depend on it.
- A verified adult with `REPRESENTANTE` capability can access a safe empty representative dashboard before representing anyone.
- `REPRESENTANTE` is a capability, not a membership state or a player role, and must not be inferred solely from the presence of a represented person.

#### Player eligibility — #1132

- Make `Membresia.estado = ACTIVA` the only source of player eligibility for backend roster, scheduling, and attendance.
- Make frontend member, dashboard, and portal derivations use the same active-membership truth.
- Do not require an `ALUMNO` role for a representative who is also an active player, and do not use payment rejection to remove representative or non-player account access.

#### Representation lifecycle — #1133

- Unify validation for creating, changing, and removing `Persona.representante_id`.
- Replace self-service reassignment with a non-disclosing safe stop and an in-person administrator route; the administrator operation atomically replaces the relationship.
- Enforce anti-self and anti-cycle constraints in the database as well as service validation, preserve active-minor reachability, and prohibit unlinking a minor.
- Record complete append-only audit evidence for creation, reassignment, and removal: actor, date, origin, old representative, and new representative as applicable. History is evidence only, never current relationship state.
- Revoke affected access after committed changes and notify through an available existing channel without creating a request, approval, or durable relationship-notification lifecycle.

#### Minor contact data — #1138

- Represented minors must neither provide nor store student phone or school type.
- Represented minors must neither provide nor send free-text emergency-contact fields. The API explicitly rejects those fields when sent; silently accepting or ignoring them is not sufficient.
- The current representative name and valid phone are the minor's operational emergency contact. Linking or reassigning a represented person requires the representative to have a valid phone.
- Legacy emergency-contact values remain stored for historical compatibility but are operationally ignored for represented minors.
- Adults without a representative continue to require emergency-contact name and phone.

#### Authenticated creation and payment conservation — #1137 with #1133 validation

- Replace public or client-selected child enrollment with an authenticated command that derives the representative server-side from session context.
- Safely find or reuse the represented person's identity and atomically persist their data, `Persona.representante_id`, and initial `Membresia` in `INACTIVA` state.
- Do not create dependent credentials or dependent `ALUMNO` roles through enrollment or represented-person paths.
- Payment approval activates membership; payment rejection preserves the already-created relationship and `INACTIVA` membership.

### 3. Existing-account remediation last — #1137

- Inventory incompatible dependent `Usuario` and role records only after the exit path, entry-path closures, and invariants are available.
- Rehearse the exact remediation in QA/staging, revoke affected sessions, and prove conservation of people, relationships, memberships, payments, medical data, attendance, consent, and audit history before credential/role removal.
- Remove only incompatible credentials and roles. Do not automatically reuse or reserve retired email addresses.
- Treat failed inventory, rehearsal, conservation, or reachability checks as stop conditions.

## Affected areas

| Area | Primary issue(s) | Expected change |
|---|---|---|
| Person, relationship, and migration services | #1133, #1137 | Single relationship projection, unified validation, anti-self/cycle and minor safeguards, atomic administrator transitions, and remediation evidence. |
| Identity, authorization, roles, and sessions | #1134, #1133, #1137 | Adult representative capability/account, unchanged-person independence account creation, backend actor authority, and affected-session revocation. |
| Membership, roster, scheduling, and attendance | #1132 | Active-membership player eligibility and consistent backend derivation. |
| Frontend member/dashboard/portal and BFF | #1132, #1134, #1133 | Empty representative dashboard, membership-derived player views, authoritative session handling, and non-disclosing reassignment stop. |
| Enrollment and represented-person APIs | #1137, #1133, #1138 | Session-derived creation, relationship validation, prohibited-field rejection, and representative-phone validation. |
| Person/contact schemas and forms | #1138 | Omit minor student phone, school type, and free-text emergency-contact inputs; retain emergency name/phone requirements for unrepresented adults. |
| Audit, notifications, tests, and remediation tooling | #1133, #1137 | Complete relationship history, post-commit existing-channel notifications, regression coverage, inventory, rehearsal, and conservation proof. |

## Authorization and data boundaries

- The server derives the representative from authenticated session context; body, URL, and BFF parameters cannot substitute that subject.
- `Persona.representante_id` is the only current relationship projection. Append-only history cannot authorize access or represent pending state.
- Only an in-person authorized administrator may reassign a representation or make an adult independent. A reassignment safe stop reveals neither the looked-up person nor their relationship.
- A representative's valid phone is mandatory when a person is linked or reassigned to them.
- `ACTIVA` controls player access only; it does not erase the representative capability or relationship after a rejected payment.

## Explicit non-goals

- No relationship request, pending state, approval flag, or parallel relationship model.
- No dependent credentials, dependent `ALUMNO` role, or public/client-selected representative flow.
- No legacy-account cleanup under #1138.
- No new admin-account activation workflow, durable relationship outbox, or relationship-approval mechanism.
- No deletion of person, medical, attendance, payment, consent, or audit history during independence or remediation.
- No automatic retired-email reuse/reservation, production remediation execution, external research, or unrelated portal redesign.

## Delivery plan and review budget

Use the configured **feature-branch chain** with a draft/no-merge #1137 tracker. Every child PR targets its immediate predecessor, is a cohesive work unit with its tests/docs, and targets at most **400 additions plus deletions**. This is a dependency-safe forecast, not a forced final count: tasks may split a unit further where its honest implementation exceeds the budget. If one cohesive split cannot fit after one slicing pass, request explicit `size:exception` approval rather than compressing or omitting code/tests.

```text
main
  └─ draft tracker: #1137 represented-person-account-flow
       └─ PR 1: #1137 adult in-person independence exit on existing persona
            └─ PR 2: #1134 adult representative account and capability backend
                 └─ PR 3: #1134 empty representative dashboard
                      └─ PR 4: #1132 backend active-membership player truth
                           └─ PR 5: #1132 frontend member/dashboard/portal derivation
                                └─ PR 6: #1138 minor-field and emergency-contact API contract
                                     └─ PR 7: #1138 form/BFF contract alignment
                                          └─ PR 8: #1133 relationship validation and database safeguards
                                               └─ PR 9: #1133 admin reassignment, audit, revocation, notifications, and safe-stop UX
                                                    └─ PR 10: #1137 authenticated represented-person creation and payment conservation
                                                         └─ PR 11: #1137 incompatible-account inventory, rehearsal, revocation, and remediation
```

| Slice | Work-unit outcome | Dependency-safe boundary |
|---|---|---|
| PR 1 | An existing represented adult has a safe administrator independence exit that preserves the same person and history. | First safety prerequisite; uses the required #1133 transition safeguards. |
| PRs 2–3 | An adult representative account has independent capability semantics and a safe empty dashboard. | Account-first capability before dependent-facing flows. |
| PRs 4–5 | Player eligibility is consistently derived from active membership on backend and frontend. | Membership truth is isolated from representative capability. |
| PRs 6–7 | Minor contact fields are rejected/removed and representative-derived operational contact is enforced. | API contract before clients depend on it. |
| PRs 8–9 | Representation creation/change/removal is validated, atomically administered, fully audited, revoked, notified, and non-disclosing. | Shared relationship safety before integrated creation. |
| PR 10 | Authenticated child creation is session-derived, atomic, credential-free, and payment-conserving. | Integrates closed entry paths with relationship and membership invariants. |
| PR 11 | Existing incompatible accounts are safely remediated with evidence. | Last by design; no one is stranded by credential removal. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Removing existing credentials strands a represented adult. | Deliver and validate the administrator independence exit before remediation. |
| A minor submits or retains operationally misleading contact data. | Reject prohibited API fields, remove them from minor flows, and derive operational contact from a valid current representative phone. |
| A client forges representative identity or discovers another relationship. | Derive the actor server-side and make reassignment safe-stop responses non-disclosing. |
| A relationship mutation creates a self-link, cycle, or unreachable active minor. | Use unified validation, database anti-self/cycle and reachability safeguards, and atomic administrator operations. |
| Membership status improperly controls account or representative access. | Keep `ACTIVA` limited to player truth and test representative capability separately. |
| Remediation loses history or invalidates access incompletely. | Inventory, QA/staging rehearsal, session revocation, conservation proof, and a stop-on-failure gate precede removal. |
| A cohesive slice exceeds review capacity. | Split once by work unit; otherwise obtain explicit `size:exception` approval. |

## Rollback

- Revert a child slice only against its immediate chain parent; preserve unrelated completed slices.
- Roll back application behavior before remediation credential removal if safety signals fail.
- Do not start remediation without a tested restoration path from pre-mutation inventory/backups.
- Never use rollback to delete preserved person, relationship history, medical, attendance, payment, membership, or consent records.

## Success criteria

- [ ] An in-person administrator can make an adult independent on the same `persona_id`, despite debt, with verified current email, audit, revocation, and preserved history.
- [ ] Adult representative accounts have `REPRESENTANTE` capability and an empty dashboard without requiring a represented person; #1134 does not implement independence.
- [ ] `ACTIVA` is the sole player truth in backend roster/scheduling/attendance and frontend member/dashboard/portal derivations, while a representative may play without `ALUMNO`.
- [ ] Representation creation, reassignment, and removal use unified validation, database anti-self/cycle protection, minor-no-unlink enforcement, complete audit, access revocation, and notifications; reassignment is administrator-only and atomic.
- [ ] A represented minor cannot submit or persist student phone, school type, or free-text emergency contact; APIs reject those fields, and operational contact uses the representative's valid name/phone.
- [ ] An unrepresented adult still requires emergency-contact name and phone, while legacy emergency values for represented minors remain stored but operationally ignored.
- [ ] Authenticated represented-person creation derives the representative server-side, creates no dependent credentials/`ALUMNO` role, and preserves relationship plus `INACTIVA` membership after rejected payment.
- [ ] Incompatible existing accounts are remediated only after inventory, QA/staging rehearsal, revocation, and conservation proof.
- [ ] Every chain slice remains within 400 changed lines or has explicit maintainer-approved `size:exception` evidence.

## Issue closure mapping

| Tracker | Closure condition |
|---|---|
| **#1137** | Close only after the full flow and its explicit safety order are complete: administrator independence exit first; closed invalid entry paths plus enforced invariants second; and inventory/rehearsal/revocation/conservation-backed incompatible-account remediation last. |
| **#1132** | Close when active membership is the player truth across backend roster, scheduling, attendance and frontend member/dashboard/portal derivation, including a representative who can play without `ALUMNO`. |
| **#1133** | Close when creation, change, and removal of representation have unified validation; database anti-self/cycle and minor-no-unlink safeguards; admin-only atomic reassignment; complete audit; access revocation; and notifications. |
| **#1134** | Close when the prior adult representative account, empty dashboard, and `REPRESENTANTE` capability semantics work independently of a represented person. |
| **#1135** | Superseded decision only; it has no implementation or closure work in this change. |
| **#1138** | Close when represented-minor phone, school type, and free-text emergency fields are prohibited and explicitly rejected; operational contact is derived from a valid representative phone; legacy emergency values are ignored operationally; and unrepresented adults still require emergency name and phone. |
