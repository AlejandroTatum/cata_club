# Represented Person Enrollment Specification

## Purpose

Define authenticated, session-derived, atomic creation of represented people without dependent credentials.

## Requirements

### Requirement: Session-derived representative authority

Represented-person creation MUST require authentication and MUST derive the representative from the server-validated session. Body, URL, browser, or BFF parameters MUST NOT select or substitute the representative.

#### Scenario: Authenticated representative creates a person

- GIVEN an authenticated eligible representative
- WHEN the representative submits valid represented-person data through the BFF/API
- THEN the backend MUST bind the new relationship to the session subject

#### Scenario: Client submits another representative

- GIVEN an authenticated representative includes another person's identifier in a body, URL, or BFF parameter
- WHEN creation is attempted
- THEN the API MUST reject or ignore it as representative authority and MUST NOT create a relationship for that other person

#### Scenario: Public creation attempt

- GIVEN no authenticated representative session exists
- WHEN represented-person creation is requested
- THEN the API MUST reject the request without persisting person, relationship, or membership data

### Requirement: Atomic identity reuse and initial membership

The system MUST safely find or reuse the represented person's identity and atomically persist the allowed person data, current relationship, complete creation audit, and one initial `INACTIVA` membership. A failed component MUST roll back the entire creation transaction.

#### Scenario: New identity commits

- GIVEN valid person data does not match an existing identity
- WHEN authenticated creation succeeds
- THEN one person, one current relationship, its audit evidence, and one `INACTIVA` membership MUST commit together

#### Scenario: Safely reusable identity commits

- GIVEN person data safely identifies an existing person eligible for this operation
- WHEN authenticated creation succeeds
- THEN the system MUST reuse the existing `persona_id` without duplicating the person
- AND MUST atomically establish the relationship, audit, and initial membership

#### Scenario: Ambiguous or protected identity stops safely

- GIVEN submitted identity data matches an existing person who cannot be safely reused by self-service
- WHEN creation is attempted
- THEN the system MUST return a non-disclosing administrator-route stop
- AND MUST NOT mutate or reveal the existing person or relationship

#### Scenario: Transaction failure rolls back

- GIVEN a failure occurs while writing person data, relationship, audit, or membership
- WHEN the transaction cannot commit
- THEN none of those changes MUST persist

#### Scenario: Concurrent duplicate creation

- GIVEN equivalent creation commands race or are retried
- WHEN identity and idempotency controls resolve them
- THEN at most one person identity, relationship outcome, creation audit event, and initial membership MUST be created
- AND retries MUST return the established outcome or a safe conflict

### Requirement: Payment outcome conserves enrollment state

Payment approval MUST activate the initial membership. Payment rejection MUST preserve the already-created current relationship and MUST leave the initial membership in `INACTIVA` state. A rejected payment MUST NOT remove representative or non-player account access.

#### Scenario: Payment is approved

- GIVEN represented-person enrollment committed with a current relationship and an `INACTIVA` membership
- WHEN payment is approved
- THEN the system MUST change that membership to `ACTIVA`
- AND MUST preserve the current relationship

#### Scenario: Payment is rejected

- GIVEN represented-person enrollment already committed with a current relationship and an `INACTIVA` membership
- WHEN payment is rejected
- THEN the system MUST preserve the already-created relationship
- AND the membership MUST remain `INACTIVA`
- AND the system MUST NOT remove representative or non-player account access

### Requirement: No represented-person credentials or ALUMNO role

Enrollment and represented-person APIs MUST NOT accept or create dependent credentials and MUST NOT assign `ALUMNO`. Dependent email/password fields MUST be explicitly rejected rather than silently accepted.

#### Scenario: Credential fields are supplied

- GIVEN a client sends dependent email or password fields
- WHEN the represented-person API validates the request
- THEN it MUST reject the request and MUST NOT create a `Usuario`, role, relationship, or membership

#### Scenario: Valid credential-free creation

- GIVEN an authenticated representative submits allowed person data without credentials
- WHEN creation commits
- THEN no dependent `Usuario` or `ALUMNO` role MUST exist as a result

### Requirement: BFF preserves backend authority

The BFF MUST expose only the authenticated represented-person command and MUST NOT convert browser-provided identity into authorization. The backend MUST remain the final authority for actor, relationship, field, and person-data access checks.

#### Scenario: BFF forwards allowed creation

- GIVEN a valid authenticated browser request contains only represented-person data
- WHEN the BFF calls the backend
- THEN it MUST preserve session authentication and the backend MUST derive the actor

#### Scenario: BFF is bypassed

- GIVEN a caller invokes the backend directly with forged actor data
- WHEN authorization is evaluated
- THEN the backend MUST reject the forgery independently of BFF validation
