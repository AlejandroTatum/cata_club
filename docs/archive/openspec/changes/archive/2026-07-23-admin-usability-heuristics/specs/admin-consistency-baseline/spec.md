# Admin Consistency Baseline Specification

## Purpose

Closes three concrete drift points found by the exploration audit:
`student/enroll` reinventing an error box instead of reusing `.alert-error`,
`forgot-password` lacking the auth-screen card fidelity its siblings have,
and skipped `h2` section-header ranks (e.g. `members`).

## Requirements

### Requirement: Student Enroll Reuses the Shared Alert-Error Class

`student/enroll/page.tsx`'s validation-error box MUST render via the shared
`.alert-error` class already used by `login`/`register`, MUST NOT keep its
bespoke error-box markup, and MUST NOT introduce a second error-styling
convention.

#### Scenario: Enroll validation error uses the shared class

- GIVEN a validation failure on a `student/enroll` step
- WHEN the error banner renders
- THEN it uses the same `.alert-error` class as `login`/`register`, with no
  duplicated bespoke markup

### Requirement: Forgot-Password Matches Auth-Screen Card Fidelity

`forgot-password/page.tsx` MUST render the same centered-card layout pattern
(card container, spacing, heading treatment) as `login`/`register`, and MUST
provide a visible way back (e.g. a link to `login`). It MUST remain a
"coming soon" state with no functional password-reset form or backend call —
implementing the real reset flow is out of scope for this change.

#### Scenario: Forgot-password matches sibling card layout

- GIVEN `forgot-password/page.tsx` after this change
- WHEN compared to `login`/`register`
- THEN all three share the same centered-card container and heading pattern

#### Scenario: No functional reset form is introduced

- GIVEN `forgot-password/page.tsx` after this change
- WHEN a user reaches the page
- THEN no password-reset form submission or backend call is present, and the
  page still communicates a "coming soon" state

#### Scenario: A way back to login is present

- GIVEN a user on `forgot-password/page.tsx`
- WHEN they look for a way back
- THEN a visible link back to `login` is present

### Requirement: Complete, Unskipped Header Rank Sequence

Every admin view MUST have an unskipped heading rank sequence (`h1` → `h2` →
`h3`, no level skipped). `members/page.tsx`, which currently has no `h2`,
MUST have an `h2` restored before its existing `h3`.

#### Scenario: Members page has a complete header sequence

- GIVEN `members/page.tsx` after this change
- WHEN its heading levels are inspected
- THEN an `h2` is present and precedes the existing `h3`, with no skipped
  rank

### Requirement: No Tailwind Config Changes

All fixes in this capability MUST use only existing `cata-*` classes and
MUST NOT add, rename, or remove any entry in `tailwind.config.ts`.

#### Scenario: Config diff stays empty

- GIVEN this capability's implementation is complete
- WHEN `tailwind.config.ts` is diffed against its pre-change state
- THEN the diff is empty
</content>
