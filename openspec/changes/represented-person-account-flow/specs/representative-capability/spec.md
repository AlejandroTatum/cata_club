# Representative Capability Specification

## Purpose

Define account-first representative access independently from represented-person links and player membership.

## Requirements

### Requirement: Account-first verified representative capability

An eligible adult account with verified email and `REPRESENTANTE` capability MUST be able to access the representative portal before representing anyone. `REPRESENTANTE` MUST denote capability only; it MUST NOT imply membership, player eligibility, or an existing relationship.

#### Scenario: New representative has no represented people

- GIVEN a verified eligible adult account has `REPRESENTANTE` and zero current links
- WHEN the user opens the representative portal
- THEN access MUST be allowed and a safe empty dashboard MUST be shown

#### Scenario: Unverified account attempts access

- GIVEN an adult has `REPRESENTANTE` but email verification is incomplete
- WHEN representative portal access is requested
- THEN the system MUST enforce the existing verification boundary without fabricating a relationship or membership state

### Requirement: Relationship grants per-person access

Representative capability MUST grant entry to representative features, while each current `Persona.representante_id` relationship MUST grant access only to that represented person's permitted data. Capability alone MUST NOT grant access to an arbitrary person.

#### Scenario: Capability without link

- GIVEN a representative has capability but no link to a requested person
- WHEN they request that person's protected data
- THEN the backend MUST deny access without disclosing relationship details

#### Scenario: Current link removed

- GIVEN a representative capability remains after their last relationship is removed
- WHEN they return to the portal
- THEN they MUST see the empty dashboard and MUST NOT retain access to the formerly represented person

### Requirement: Administrator-only capability removal

Only an authorized administrator MUST remove `REPRESENTANTE`, and removal MUST be allowed only when the person has zero current represented-person links. Payment or membership changes MUST NOT remove the capability.

#### Scenario: Remove unused capability

- GIVEN a representative has zero current links and an authorized administrator requests capability removal
- WHEN validation completes
- THEN the system MUST remove `REPRESENTANTE` and revoke affected representative sessions or access

#### Scenario: Linked capability removal is rejected

- GIVEN a representative has at least one current represented-person link
- WHEN an administrator requests capability removal
- THEN the system MUST reject the operation and preserve capability and relationship reachability

#### Scenario: Non-admin removal is rejected

- GIVEN a representative or other unauthorized actor requests capability removal
- WHEN the request reaches the API
- THEN the backend MUST deny it without changing capability or links
