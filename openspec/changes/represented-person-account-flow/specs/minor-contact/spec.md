# Minor Contact Specification

## Purpose

Define allowed represented-minor contact data and authoritative emergency-contact derivation while retaining adult emergency-contact behavior.

## Requirements

### Requirement: Represented-minor prohibited fields

For a represented minor, the system MUST NOT accept or persist the minor's student phone, school type, or free-text emergency-contact name or phone. Every API accepting person data MUST explicitly reject supplied prohibited fields, including non-empty, empty, or null values, rather than silently ignore them.

#### Scenario: Minor phone is supplied

- GIVEN a represented minor payload contains a student phone field
- WHEN the API validates creation or update
- THEN it MUST reject the request and MUST NOT persist any part of the mutation

#### Scenario: School type is supplied as null

- GIVEN a represented minor payload explicitly contains school type with a null value
- WHEN the API validates the request
- THEN it MUST reject the field rather than treating it as omitted

#### Scenario: Emergency fields are supplied through BFF

- GIVEN a represented minor form or direct request sends free-text emergency name or phone
- WHEN the BFF/API processes it
- THEN the request MUST be rejected and the BFF MUST NOT hide the backend validation result

#### Scenario: Valid minor payload omits fields

- GIVEN a represented minor payload omits all prohibited fields
- WHEN other validation succeeds
- THEN the system MAY persist the allowed minor data

### Requirement: Current representative is operational emergency contact

The current representative's name and valid phone MUST be the represented minor's operational emergency contact. Linking or reassigning the minor MUST fail if the resulting current representative lacks a valid phone.

#### Scenario: Emergency contact is read

- GIVEN a represented minor has a current representative with a valid phone
- WHEN an authorized roster, attendance, scheduling, or emergency workflow requests operational contact
- THEN the system MUST return the current representative's name and phone

#### Scenario: Former representative is not used

- GIVEN a minor was reassigned and historical emergency values still exist
- WHEN operational contact is requested
- THEN the system MUST use only the current representative and MUST NOT return the former or legacy contact as authoritative

#### Scenario: Concurrent phone invalidation and link

- GIVEN a representative's phone becomes invalid concurrently with a minor link or reassignment
- WHEN the relationship transaction commits
- THEN the system MUST prevent an outcome in which the minor is linked to a representative without a valid phone

### Requirement: Legacy minor values are non-operational

Legacy student phone, school type, and emergency-contact values for represented minors MAY remain stored for historical compatibility, but every operational read and decision MUST ignore them.

#### Scenario: Legacy values remain in storage

- GIVEN a represented minor has legacy prohibited values in persisted records
- WHEN operational contact or person data is projected to authorized clients
- THEN those values MUST NOT be treated as current operational data
- AND emergency contact MUST be derived from the current representative

### Requirement: Adult emergency fields remain required

An adult without a representative MUST continue to provide emergency-contact name and phone. The represented-minor prohibition MUST NOT remove or weaken this adult requirement.

#### Scenario: Unrepresented adult provides contact

- GIVEN an unrepresented adult supplies valid emergency-contact name and phone
- WHEN adult person data is created or updated
- THEN the system MUST accept the fields when all other validation succeeds

#### Scenario: Unrepresented adult omits contact

- GIVEN an unrepresented adult omits emergency-contact name or phone
- WHEN adult person data is created or updated
- THEN the system MUST reject the request
