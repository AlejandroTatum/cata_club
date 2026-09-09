# Player Eligibility Specification

## Purpose

Define one membership-based truth for player visibility and participation across backend and frontend surfaces.

## Requirements

### Requirement: Active membership is sole player truth

The system MUST treat `Membresia.estado = ACTIVA` as the sole criterion for player/member eligibility in roster, scheduling, and attendance. Roles, representation relationships, payment records, and account capability MUST NOT independently grant player eligibility.

#### Scenario: Active member participates

- GIVEN a person has an `ACTIVA` membership
- WHEN roster, scheduling, or attendance eligibility is evaluated
- THEN every backend surface MUST treat that person as an eligible player

#### Scenario: Non-active membership is excluded

- GIVEN a person's membership is `INACTIVA`, `VENCIDA`, or `SUSPENDIDA`
- WHEN roster, scheduling, or attendance eligibility is evaluated
- THEN every backend surface MUST exclude that person as a player even if they have `ALUMNO` or `REPRESENTANTE`

#### Scenario: Role without membership is insufficient

- GIVEN a person has an account role but no `ACTIVA` membership
- WHEN player eligibility is evaluated
- THEN the system MUST NOT expose or schedule that person as a player

### Requirement: Representative may also play

A person with `REPRESENTANTE` capability and an `ACTIVA` membership MUST be eligible as a player without requiring `ALUMNO`.

#### Scenario: Representative without ALUMNO is active player

- GIVEN a representative has an `ACTIVA` membership and no `ALUMNO` role
- WHEN roster, scheduling, or attendance is requested
- THEN the system MUST include the representative as an eligible player

#### Scenario: Representative without active membership is not a player

- GIVEN a representative has no `ACTIVA` membership
- WHEN player eligibility is requested
- THEN the system MUST exclude the representative as a player while preserving authorized representative/account access

### Requirement: Frontend and BFF share membership truth

Frontend member, dashboard, and portal projections MUST derive player state from authoritative active-membership data returned through the BFF. The browser MUST NOT infer player eligibility from roles or represented-person links, and BFF parameters MUST NOT override the authenticated backend subject.

#### Scenario: Active membership projection

- GIVEN the backend reports an `ACTIVA` membership for the authenticated or authorized represented person
- WHEN the BFF constructs the portal response
- THEN the frontend MUST render that person as a player/member consistently with backend eligibility

#### Scenario: Forged person parameter

- GIVEN a browser supplies another person's identifier to a BFF route
- WHEN the BFF requests membership or player data
- THEN the backend MUST authorize from the authenticated session and current relationship
- AND the BFF MUST NOT broaden access from the supplied identifier

### Requirement: Payment states affect membership without erasing access

An approved payment MUST activate the applicable membership. A rejected payment MUST preserve the represented-person relationship and leave the initial membership `INACTIVA`; it MUST NOT remove representative capability or unrelated account/portal access.

#### Scenario: Payment approved

- GIVEN a represented person has an `INACTIVA` membership and a payment is approved
- WHEN payment validation commits
- THEN the membership MUST become `ACTIVA` and player projections MUST become eligible

#### Scenario: Payment rejected

- GIVEN represented-person creation and its `INACTIVA` membership already committed
- WHEN payment is rejected
- THEN the relationship and membership record MUST remain
- AND player eligibility MUST remain false without revoking representative capability or unrelated portal access

#### Scenario: Duplicate payment result

- GIVEN a payment outcome was already processed
- WHEN the same outcome is delivered concurrently or retried
- THEN membership state MUST remain consistent and the system MUST NOT create duplicate memberships or reverse the represented-person relationship
