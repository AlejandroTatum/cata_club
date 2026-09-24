# 1383 — Enroll legal review: merge origin/main

## Objective

Resolve PR #1383 (`fix/enroll-legal-review`, head `c5a5948`) against latest
`origin/main` (`5a7108a`) in the dedicated worktree `gentleman-1383`, with a
semantic resolution that preserves both the enroll wizard in-flow legal review
and main's post-merge fixes (chatbot removal, legal dialog foundation fixes).

Single writer. No push, no PR merge: delivery waits for parent review.

## Conflict map (merge-base `3eafba9`)

| File | Main since base | PR side | Resolution |
| --- | --- | --- | --- |
| `frontend/src/app/student/enroll/page.tsx` | M — removed `HelpChatLauncher` (chatbot removal) | M — legal review dialog integration, consent triggers as buttons, `legalReviewDoc` state | PR integration MINUS every chatbot trace; keep main's back-link comments |
| `frontend/src/app/terminos/LegalDocumentPage.tsx` | M — shared `LegalDocumentProse` | M — identical bytes | Auto: no conflict expected |
| `frontend/src/components/legal/LegalReviewDialog.tsx` | A — foundation as merged to main | A — same, minus stale ChatWidget comment | Take main (no dead ChatWidget reference) |
| `frontend/src/components/legal/__tests__/LegalReviewDialog.test.tsx` | A | A — identical bytes | Auto: no conflict expected |
| `frontend/src/app/student/enroll/__tests__/EnrollPage.test.tsx` | — | M | PR side; sweep stale chatbot assertions if any |
| `frontend/tests/e2e/enroll-legal-review.spec.ts` | — | A | PR side; sweep stale chatbot references if any |
| `odd/tasks/club-experience-improvements.md` | — | M | PR side |

## Tasks

- [x] T1: Merge `origin/main` into `fix/enroll-legal-review`; conflict set matched the map exactly (2 conflicts: `enroll/page.tsx` UU, `LegalReviewDialog.tsx` AA).
- [x] T2: Resolve `enroll/page.tsx`: PR legal-review integration + main chatbot removal (single import block conflict; zero chatbot references remain).
- [x] T3: Resolve add/add `LegalReviewDialog.tsx` (main version; 0 ChatWidget references).
- [x] T4: Sweep chatbot references in PR-only files: none found (enroll test, e2e spec, legal components clean).
- [x] T5: Focused tests: EnrollPage + LegalReviewDialog vitest files — 2 files, 78/78 passed.
- [x] T6: `make pre-pr LANE=frontend` — green end to end: secrets guard, audit, type-check, lint, coverage, build, Playwright E2E 203/203 (3.4m).
- [x] T7: Conventional merge commit recording the resolution. No push.

## Constraints

- Work only in `gentleman-1383` worktree; preserve root untracked work
  (`odd/tasks/1362-catalogo-vacio-instalacion-nueva.md`) — untouched.
- Never force-push; never merge the PR; no production config.

## Evidence

- Worktree: `gentleman-1383`; branch `fix/enroll-legal-review`; merge of `origin/main` (`5a7108a`) into PR head `c5a5948`.
- Merge delta vs `origin/main` (what the PR adds after resolution): `EnrollPage.test.tsx` +106, `enroll/page.tsx` +30/−, `enroll-legal-review.spec.ts` +207, `odd/tasks/club-experience-improvements.md` +34; zero delta on `LegalReviewDialog.tsx`, its test, and `LegalDocumentPage.tsx` (kept main's).
- Focused: `pnpm exec vitest run src/app/student/enroll/__tests__/EnrollPage.test.tsx src/components/legal/__tests__/LegalReviewDialog.test.tsx` → 78/78 passed.
- Lane: `make pre-pr LANE=frontend` → completed; Playwright 203/203 passed. No gate skipped in this lane; CI-only gates not reproduced locally (per Makefile): `docker-images` production-image job.
- Failure classification: none required — no red gate observed.
