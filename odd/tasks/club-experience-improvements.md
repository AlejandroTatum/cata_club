# Club Experience Improvements

## Objective

Deliver six coordinated product improvements without overlapping the active worktrees for minor direct payments and chatbot replacement.

## Problem and why

Administrators cannot manage achievements as content; legal-document navigation loses enrolment data; fully discounted membership periods are missing from payment-facing history and admin notifications; attendance lacks sick and competition states; transactional emails have weak identity and sparse layouts; and child registration/payment notifications do not reliably reach the representative or administrators.

## Scope

Included:

- Data-driven achievement gallery with admin image/description management and an interactive landing presentation.
- Terms/privacy/image-permission review from enrolment without losing form state, preserving landing visual language, with Playwright coverage.
- 100% discount history, administrator notifications, and one-month-at-a-time activation.
- Sick and competition attendance states with explicit reporting semantics.
- Shared branded transactional-email layout, sender identity guidance, richer copy, and useful visual content.
- Representative/admin notifications for child registration and payment flows.

Excluded because active sibling worktrees already own them:

- Direct payment for an unenrolled minor (`fix/minor-registration-payments-schedules`).
- FAQ/chatbot replacement and live schedule strategy (`refactor/remove-chatbot-ui`).

## Constraints

- Work only in `gentleman-club-experience-improvements`.
- Preserve unrelated tracked and untracked work.
- Technical artifacts default to English; existing user-facing Spanish copy stays consistent with the product.
- Bug-fix PRs require linked GitHub issues.
- Use focused checks first and exactly one applicable `make pre-pr LANE=...` before delivery.
- Backend tests use the single-tenant PostgreSQL service on port 5436.
- Do not edit sibling worktrees or overlap their assigned product areas.
- Native RDD is enabled; use committed work units as candidates.

## Delivery forecast

Estimated authored diff: 1,200–2,000 lines across six vertical slices. This exceeds the approximate 400-line review budget, so chained/review-sized PR slices are required before delivery. Strategy is pending user confirmation at the first commit boundary.

## Tasks

- [ ] **CCI-00 — Establish the repository bug Issue Form** *(implemented and verified; delivery blocked)*
  - Route: inline direct; one-file repository policy prerequisite explicitly authorized by the user.
  - Add a YAML bug-report form with required reproduction, expected behavior, impact, and validation controls.
  - Deliver and merge this prerequisite before creating the required CCI-01 bug issue.
  - Checks: YAML parse/readback and repository policy inspection.
- [ ] **CCI-01 — Preserve enrolment state while reviewing legal documents**
  - Route: delegated writer; multi-file frontend change and Playwright verification.
  - Build an in-flow legal review surface using landing visual language, return to confirmation, and retain all entered data and consent state.
  - Add component tests and Playwright coverage for the round trip.
  - Checks: focused Vitest and Playwright scenarios; frontend pre-PR lane at slice close.
- [ ] **CCI-02 — Add sick and competition attendance states**
  - Route: delegated writer; backend/frontend vertical slice.
  - Extend domain/API/UI mappings, marking controls, badges, and statistics with explicit neutral/justified semantics.
  - Add backend and frontend regression tests.
  - Checks: focused backend and frontend tests; full pre-PR lane at slice close.
- [ ] **CCI-03 — Build achievement gallery administration**
  - Route: delegated writer; schema/API/admin UI vertical slice.
  - Add persisted achievement image and description management modeled on sponsors, including migration and upload validation.
  - Add backend and admin UI tests.
  - Checks: focused backend/frontend tests.
- [ ] **CCI-04 — Make the landing achievement gallery interactive**
  - Route: delegated writer; frontend integration dependent on CCI-03.
  - Consume managed achievements and reveal descriptions through accessible hover/focus enlargement with responsive fallback behavior.
  - Add component and Playwright coverage.
  - Checks: focused Vitest and Playwright scenarios; full pre-PR lane at slice close.
- [ ] **CCI-05 — Correct 100% discount lifecycle**
  - Route: delegated writer; backend/frontend vertical slice.
  - Surface bonified coverage in history, notify administrators, and restrict activation to one month per action.
  - Add service/API/UI regression tests.
  - Checks: focused backend/frontend tests; full pre-PR lane at slice close.
- [ ] **CCI-06 — Improve transactional email identity and layout**
  - Route: delegated writer; backend notification templates and tests.
  - Introduce a reusable branded template, stronger copy, purposeful imagery, and documented sender-avatar requirements without pretending HTML controls mailbox avatars.
  - Checks: fake-SMTP focused tests and backend pre-PR lane at slice close.
- [ ] **CCI-07 — Repair child registration and payment notifications**
  - Route: delegated writer; backend notification/outbox behavior and tests.
  - Ensure representatives and administrators receive the correct deduplicated notifications for child registration and payment outcomes.
  - Checks: focused backend tests and backend pre-PR lane at slice close.

## Acceptance criteria

- Legal review never discards enrolment progress and returns to the confirmation step.
- Legal pages/surfaces visually align with the public landing system and pass the requested Playwright journey.
- Every 100% coverage activation creates visible history, reaches administrators, and covers no more than one month per action.
- Trainers can mark sick and competition; reporting does not penalize either state as an unexcused absence.
- Administrators can add achievement images with descriptions; landing users can reveal descriptions by pointer and keyboard focus.
- Transactional emails share a branded, content-complete responsive template; sender profile-image limitations are documented accurately.
- Child registration/payment events notify the representative and the intended administrator audience without duplicates.
- Focused tests and the required pre-PR lane pass for each delivered slice.

## Progress and evidence

- 2026-09-11: Created isolated worktree and branch from `origin/main` at `7e84ecf`.
- 2026-09-11: Read-only mapping completed across all requested areas.
- 2026-09-11: User chose to exclude the two areas already owned by sibling worktrees.
- 2026-09-22: GitHub discovery confirmed no duplicate CCI-01 issue and no YAML Issue Form on `main`; repository policy therefore blocks bug-issue publication.
- 2026-09-22: User explicitly authorized adding the missing YAML bug Issue Form.
- 2026-09-22: Added `.github/ISSUE_TEMPLATE/bug.yml` and committed it with this feature document as `d8bcdfff58f4cf31235f05d33d284e432077aea0` (`chore(repo): add bug issue form`).
- 2026-09-22: YAML/form validation passed; independent verification passed; native review approved and acknowledgement burned authority for the commit.
- 2026-09-22: `make pre-pr LANE=integration` passed (`638 passed, 1 skipped`); CI image build/publication was not reproduced locally by that lane.
- 2026-09-22: Delivery is blocked by a bootstrap cycle: every PR requires an open `status:approved` issue, but issue publication requires a YAML Issue Form already present on `main`. No existing issue semantically authorizes this form.

## Next step

Obtain a manually created and approved bootstrap issue for the Issue Form, then push/open the CCI-00 PR, enable squash auto-merge, monitor CI, and continue with CCI-01 after the form reaches `main`.
