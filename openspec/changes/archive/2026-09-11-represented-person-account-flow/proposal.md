# Represented-person account flow

> **Scope note (replan 2026-09-10).** This change now delivers only the three
> tramos decided in #1137: the administrator desk exit, closing every path that
> gives a represented person credentials, and detecting legacy accounts. The
> account-first representative capability (#1134), relationship reassignment,
> safe-stop linking and notifications (#1133), active-player truth (#1132) and
> minor-contact rules (#1138) described below are **out of this change** and
> return to their issues. `tasks.md` is authoritative for what ships.

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

Use the configured **feature-branch chain** with the draft/no-merge tracker #1164. The original 14-child-PR/400-line plan is superseded by a compact plan of **7 implementation PRs**. Every PR targets its immediate predecessor, is one cohesive work unit with its tests/docs, and targets **600–900 additions plus deletions** with a **hard stop at 1,000**; a cohesive slice that cannot land at or below 1,000 stops and is re-sliced instead of requesting a routine size exception. The earlier size exception granted to the monolithic independence slice (~1,795 changed lines) is superseded by this replan: that local slice is not publishable whole and is salvaged into PRs 2–3. Execution is automatic: each slice runs implement/TDD → focused validation → independent verification → native review when applicable → commit/push/open chained PR, without routine workflow questions.

```text
main
  └─ draft tracker #1164: #1137 represented-person-account-flow
       └─ PR 1 (open, #1165): audit/idempotency foundation
            └─ PR 2: existing-person credential + REPRESENTANTE capability primitives
                 └─ PR 3: administrator independence vertical cutover
                      └─ PR 4: relationship integrity and admin reassignment
                           └─ PR 5: account-first representative and represented-minor enrollment
                                └─ PR 6: ACTIVA player truth and frontend experience
                                     └─ PR 7: legacy account remediation and final E2E
```

| Slice | Work-unit outcome | Dependency-safe boundary |
|---|---|---|
| PR 1 (#1165) | Append-only relationship-audit and idempotency foundation. | Shipped first; later slices depend on it. |
| PR 2 | Existing-person credential core plus shared `REPRESENTANTE` capability primitives (#762-compatible) with focused tests, salvaged from local WIP. | Account/credential primitives exist before the independence cutover uses them. |
| PR 3 | Administrator independence vertical cutover: relationship service command, DTO/router, audit/session/notification effects, and retirement of the self-service independence implementation/tests/guards. | Safe independence exists before any represented credential is removed; hard stop 1,000. |
| PR 4 | Shared relationship validation, database self/cycle/age/phone safeguards, atomic administrator reassignment, non-disclosing safe stop, and audit/revocation/notification effects. | Relationship integrity precedes dependent creation flows. |
| PR 5 | Account-first adult representative (account/verification/empty capability state) and session-derived represented-minor enrollment with no child `Usuario`/`ALUMNO`; atomic Persona + relationship + medical + consent + `INACTIVA` membership + `PENDIENTE` payment; #1138 write-field rules. | Closed entry paths before player-truth and frontend work. |
| PR 6 | `ACTIVA` player predicate across members/schedule/attendance, representative-as-player, empty dashboard, and BFF/forms/derived emergency-contact experience. | Membership truth and portal experience land together on stable contracts. |
| PR 7 | Legacy-account remediation inventory/rehearsal/revocation/conservation gate (no production execution) plus full cross-flow E2E and cleanup. | Last by design; no one is stranded by credential removal. |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Removing existing credentials strands a represented adult. | Deliver and validate the administrator independence exit before remediation. |
| A minor submits or retains operationally misleading contact data. | Reject prohibited API fields, remove them from minor flows, and derive operational contact from a valid current representative phone. |
| A client forges representative identity or discovers another relationship. | Derive the actor server-side and make reassignment safe-stop responses non-disclosing. |
| A relationship mutation creates a self-link, cycle, or unreachable active minor. | Use unified validation, database anti-self/cycle and reachability safeguards, and atomic administrator operations. |
| Membership status improperly controls account or representative access. | Keep `ACTIVA` limited to player truth and test representative capability separately. |
| Remediation loses history or invalidates access incompletely. | Inventory, QA/staging rehearsal, session revocation, conservation proof, and a stop-on-failure gate precede removal. |
| A cohesive slice exceeds the 1,000 changed-line hard stop. | Stop before delivery and re-slice by work unit; no routine size exceptions. |

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
- [ ] Each of the seven implementation PRs lands within its 600–900 changed-line target and none exceeds the 1,000-line hard stop.

## Issue closure mapping

| Tracker | Closure condition |
|---|---|
| **#1137** | Close only after the full flow and its explicit safety order are complete: administrator independence exit first; closed invalid entry paths plus enforced invariants second; and inventory/rehearsal/revocation/conservation-backed incompatible-account remediation last. |
| **#1132** | Close when active membership is the player truth across backend roster, scheduling, attendance and frontend member/dashboard/portal derivation, including a representative who can play without `ALUMNO`. |
| **#1133** | Close when creation, change, and removal of representation have unified validation; database anti-self/cycle and minor-no-unlink safeguards; admin-only atomic reassignment; complete audit; access revocation; and notifications. |
| **#1134** | Close when the prior adult representative account, empty dashboard, and `REPRESENTANTE` capability semantics work independently of a represented person. |
| **#1135** | Superseded decision only; it has no implementation or closure work in this change. |
| **#1138** | Close when represented-minor phone, school type, and free-text emergency fields are prohibited and explicitly rejected; operational contact is derived from a valid representative phone; legacy emergency values are ignored operationally; and unrepresented adults still require emergency name and phone. |
