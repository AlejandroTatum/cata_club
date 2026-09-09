# Representation Lifecycle Specification

## Purpose

Define the authoritative relationship lifecycle, administrator transitions, authorization, audit, and access effects for represented people.

## Requirements

### Requirement: Single current relationship truth

The system MUST use `Persona.representante_id` as the sole current representation state. Audit history MUST be evidence only and MUST NOT authorize access or encode a request, pending, or approval state.

#### Scenario: Current representative receives person-scoped access

- GIVEN a person whose `representante_id` identifies an authenticated representative
- WHEN the representative requests that person's permitted data
- THEN the system MUST authorize access from the current relationship and applicable permissions

#### Scenario: Historical representative is denied

- GIVEN an audit record names a former representative but `representante_id` names another representative
- WHEN the former representative requests the person's data
- THEN the system MUST deny access without treating history as current authority

### Requirement: Unified relationship validation

Creation, reassignment, and removal MUST use the same relationship invariants. The system MUST reject self-representation, every direct or indirect cycle, and linking or reassigning to a representative who is not eligible and reachable. Linking or reassignment MUST require the current representative to have a valid phone.

#### Scenario: Valid creation

- GIVEN an eligible authenticated representative with a valid phone and a person not already in the relationship graph
- WHEN an authorized creation command links the person
- THEN the system MUST persist a relationship that satisfies all shared invariants

#### Scenario: Service self-link is rejected

- GIVEN a proposed representative and represented person are the same person
- WHEN a relationship service entry point attempts the link
- THEN service validation MUST reject it without changing the existing graph

#### Scenario: Direct database self-link is rejected

- GIVEN an existing valid relationship graph and a person who would be linked to themselves
- WHEN a direct database write bypasses the relationship service and attempts the self-link
- THEN the database MUST reject the write
- AND the complete prior relationship graph MUST remain unchanged

#### Scenario: Service indirect cycle is rejected

- GIVEN a proposed link would make a person an ancestor of themselves through representation links
- WHEN a relationship service entry point attempts the link
- THEN service validation MUST reject it without changing the existing graph

#### Scenario: Direct database indirect cycle is rejected

- GIVEN an existing valid relationship graph and a proposed link that would create an indirect cycle
- WHEN a direct database write bypasses the relationship service and attempts the link
- THEN the database MUST reject the write
- AND the complete prior relationship graph MUST remain unchanged

#### Scenario: Representative phone is invalid

- GIVEN a proposed representative lacks a valid current phone
- WHEN creation or reassignment is attempted
- THEN the system MUST reject the operation and MUST NOT change the relationship

### Requirement: Minor reachability database safeguard

An active represented minor MUST retain an eligible, reachable current representative. The database MUST reject writes that violate this invariant, including writes outside application services. The safeguard MUST evaluate current age when the write occurs.

#### Scenario: Minor unlink is rejected at the database boundary

- GIVEN an active represented person is currently under 18
- WHEN a direct database write clears their `representante_id`
- THEN the database MUST reject the write and preserve the relationship

#### Scenario: Represented person has aged past 18

- GIVEN a represented person's birth date now makes them at least 18 even though they were a minor when linked
- WHEN an otherwise valid authorized transaction clears their `representante_id`
- THEN the database trigger MUST permit the adult transition

#### Scenario: Representative becomes unreachable

- GIVEN an active minor depends on a representative
- WHEN a write would make that representative ineligible or unreachable without a valid replacement
- THEN the database MUST reject the write

### Requirement: Non-disclosing self-service stop

Self-service clients MUST NOT create, replace, or request a relationship for an identity that may already exist. Such attempts MUST stop safely, reveal neither whether the person exists nor their relationship, and direct the user to the in-person administrator route.

#### Scenario: Existing person is looked up

- GIVEN a representative submits identifying data that matches an existing person
- WHEN the self-service flow cannot safely create the relationship
- THEN the response and UI MUST provide the same non-disclosing safe stop used for any ambiguous match
- AND the system MUST NOT create a request or pending relationship state

#### Scenario: Unauthorized caller probes a relationship

- GIVEN an unauthenticated or unauthorized caller submits another person's identifier
- WHEN the caller invokes a relationship endpoint
- THEN the API MUST deny or safely stop the request without disclosing the person's existence, representative, or relationship status

### Requirement: Administrator-only atomic reassignment

Only an authorized in-person administrator MUST be able to reassign representation. Reassignment MUST atomically replace the old representative with the new representative and its audit evidence; partial replacement MUST NOT be observable.

#### Scenario: Authorized reassignment commits

- GIVEN identity verification is complete, the new representative passes shared validation, and the actor is an authorized administrator
- WHEN the administrator reassigns the person
- THEN the old relationship and new relationship MUST be replaced in one transaction
- AND complete audit evidence MUST commit with the replacement

#### Scenario: Concurrent reassignment loses authority

- GIVEN two administrators concurrently attempt different reassignments from the same known current relationship
- WHEN one transaction commits first
- THEN the other MUST fail safely or return the already-current result only if equivalent
- AND it MUST NOT overwrite the newer relationship or produce contradictory audit history

#### Scenario: Reassignment transaction fails

- GIVEN any relationship or audit write fails before commit
- WHEN reassignment is attempted
- THEN the transaction MUST roll back the relationship and audit changes
- AND no success notification MUST be emitted

### Requirement: Adult independence transition

Only an authorized in-person administrator MUST make a represented person independent. The person MUST currently be an adult, identity verification and a current verified email MUST be established, and a `Usuario` MUST be created against the unchanged `persona_id` before representation is removed. Debt MUST NOT block independence, and the transition MUST NOT create an `ALUMNO` role.

#### Scenario: Adult becomes independent despite debt

- GIVEN a represented adult has debt, passes in-person identity verification, and provides a current email that is verified
- WHEN an authorized administrator performs independence
- THEN the system MUST create or establish the adult account on the same `persona_id`
- AND MUST remove representation atomically without deleting preserved records

#### Scenario: Minor independence is rejected

- GIVEN the represented person is under 18
- WHEN an administrator attempts independence
- THEN the service and database MUST reject removal and preserve the current relationship

#### Scenario: Account creation fails

- GIVEN an adult otherwise qualifies for independence
- WHEN account creation, email verification, relationship removal, or audit persistence fails
- THEN the complete transition MUST roll back and the existing representation MUST remain usable

#### Scenario: Repeated independence command

- GIVEN an independence command is retried after its transaction committed
- WHEN the same operation is submitted again
- THEN the system MUST return the established outcome or reject it as already complete
- AND MUST NOT create duplicate users or duplicate successful transition evidence

### Requirement: Complete append-only relationship audit

Every successful creation, reassignment, and removal MUST append durable evidence containing actor, date, origin, represented person, old representative when applicable, and new representative when applicable. Audit records MUST NOT be mutated into current relationship state.

#### Scenario: Relationship creation is audited

- GIVEN a represented-person creation commits
- WHEN audit evidence is inspected
- THEN it MUST identify the actor, date, origin, represented person, null old representative, and new representative

#### Scenario: Reassignment is audited

- GIVEN an administrator reassignment commits
- WHEN audit evidence is inspected
- THEN it MUST identify the administrator actor, date, in-person origin, represented person, old representative, and new representative

#### Scenario: Independence is audited

- GIVEN an independence transition commits
- WHEN audit evidence is inspected
- THEN it MUST identify the administrator actor, date, in-person origin, represented person, old representative, and null new representative

### Requirement: Post-commit revocation and notifications

After a committed reassignment or removal, the system MUST revoke all affected access based on the old relationship. When an existing notification channel is available, the system MUST attempt to notify affected parties only after the relationship transaction commits. Delivery MUST be best-effort: notification failure MUST NOT roll back or invalidate the committed relationship operation. The system MUST NOT create a durable relationship outbox, request, pending state, approval state, or other relationship-notification lifecycle.

#### Scenario: Former representative access is revoked

- GIVEN reassignment has committed
- WHEN the former representative uses an existing session to access the person
- THEN access MUST be denied, including where session revocation or authorization caches previously granted access

#### Scenario: Available channel is notified after commit

- GIVEN a valid relationship transition has committed and an existing notification channel is available for an affected party
- WHEN post-commit effects run
- THEN the system MUST attempt notification through that channel
- AND it MUST NOT create a durable relationship outbox, request, pending state, or approval state

#### Scenario: Notification delivery fails

- GIVEN a valid relationship transition has committed
- WHEN the existing notification channel is unavailable
- THEN the relationship and audit MUST remain committed
- AND the failure MUST be observable for operations without exposing protected relationship data
