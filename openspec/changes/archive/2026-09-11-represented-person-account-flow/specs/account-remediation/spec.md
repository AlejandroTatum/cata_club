# Account Remediation Specification

## Purpose

Define the mandatory delivery order and conservation gates for safely removing incompatible represented-person accounts and roles.

## Requirements

### Requirement: Safe delivery order

The administrator independence exit MUST be available and validated before invalid represented-person credential and entry paths are closed and invariants enforced. Existing incompatible-account remediation MUST run only after both preceding stages are complete. #1135 MUST remain superseded and MUST produce no implementation or separate closure behavior.

#### Scenario: Remediation is requested too early

- GIVEN independence or target entry-path/invariant enforcement is incomplete
- WHEN incompatible-account remediation is requested
- THEN the system or operating procedure MUST stop before removing credentials or roles

#### Scenario: Superseded tracker is encountered

- GIVEN work is mapped to #1135
- WHEN change scope is evaluated
- THEN no runtime behavior, migration, or relationship state MUST be added for that issue

### Requirement: Remediation inventory and rehearsal

Before removal, remediation MUST produce an exact inventory of incompatible dependent `Usuario` and role records and MUST rehearse the same operation in QA or staging against representative data. Execution MUST stop before any credential or role removal when the inventory is missing, incomplete, failed, or changed; when the QA/staging rehearsal is missing or failed; when a tested restoration path is missing or failed; when the affected-session revocation plan or its proof is missing or failed; or when conservation evidence is missing or failed.

#### Scenario: Required execution evidence is absent or failed

- GIVEN inventory, QA/staging rehearsal, a tested restoration path, an affected-session revocation plan, and conservation evidence are required
- WHEN any one of those gates is missing, incomplete, changed, or failed
- THEN remediation MUST stop before execution
- AND no incompatible credential or role write MUST begin

#### Scenario: Inventory is complete

- GIVEN prerequisite behavior is deployed in the rehearsal environment
- WHEN inventory runs
- THEN every candidate credential and role MUST be identified with enough stable identity to reconcile before and after counts

#### Scenario: Inventory changes after approval

- GIVEN an inventory was reviewed but candidate records changed before execution
- WHEN remediation starts
- THEN it MUST stop and require a fresh inventory and reconciliation

#### Scenario: Rehearsal fails

- GIVEN the exact remediation is rehearsed in QA or staging
- WHEN any removal, revocation, reachability, rollback, or conservation check fails
- THEN production remediation MUST NOT proceed

### Requirement: Conservation proof and reachability stop

Remediation MUST prove conservation of people, current relationships, memberships, payments, medical data, attendance, consent, and audit history. It MUST prove that active minors remain reachable. Any mismatch or reachability failure MUST stop and roll back the mutation batch without deleting conserved records.

#### Scenario: Conservation succeeds

- GIVEN a rehearsed candidate inventory and restoration path exist
- WHEN a remediation batch is evaluated
- THEN before-and-after evidence MUST show only incompatible credentials and roles were removed
- AND every conserved record class and relationship invariant MUST match expected counts and identities

#### Scenario: Conservation mismatch occurs

- GIVEN a remediation transaction would alter a person, relationship, membership, payment, medical, attendance, consent, or audit record unexpectedly
- WHEN conservation checks run
- THEN the batch MUST roll back or stop before commit

#### Scenario: Active minor would become unreachable

- GIVEN credential or capability removal would make an active minor's representative unreachable
- WHEN database and remediation checks evaluate the batch
- THEN the database MUST reject the unsafe change and remediation MUST stop

### Requirement: Credential and role removal with access revocation

After all gates pass, remediation MUST remove only incompatible dependent credentials and roles, MUST revoke every affected session/access grant, and MUST leave the underlying person and conserved records intact. Removed email addresses MUST NOT be automatically reused or reserved.

#### Scenario: Eligible batch commits

- GIVEN inventory, rehearsal, restoration, conservation, and reachability checks pass
- WHEN remediation commits
- THEN only inventoried incompatible `Usuario` and role records MUST be removed
- AND affected sessions MUST no longer authorize access

#### Scenario: Session revocation fails

- GIVEN a candidate account has an active session
- WHEN required revocation cannot be proven
- THEN remediation MUST stop or roll back that batch rather than leave usable credentials or sessions

#### Scenario: Retired email is encountered later

- GIVEN remediation removed an incompatible account using an email address
- WHEN a later account flow evaluates that address
- THEN remediation history alone MUST neither reserve the address nor authorize its automatic reuse

### Requirement: Idempotent and isolated remediation

Remediation MUST be restartable without deleting additional records and MUST detect concurrent changes to its inventory. Each committed batch MUST have reconcilable evidence; a retry MUST skip or safely confirm already-remediated candidates.

#### Scenario: Batch is retried after commit

- GIVEN a remediation batch committed but its caller did not receive confirmation
- WHEN the same batch is retried
- THEN it MUST NOT remove unrelated records or duplicate evidence
- AND it MUST report the already-remediated result or safely reconcile it

#### Scenario: Candidate changes concurrently

- GIVEN a candidate's relationship, role, or account state changes after inventory
- WHEN remediation attempts that candidate
- THEN optimistic or locking controls MUST prevent stale removal and MUST stop that candidate for reinventory
