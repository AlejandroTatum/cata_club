# Issue #1347 — Stepper follow-ups (review advisory de #1346)

- Issue: https://github.com/AlejandroTatum/cata_club/issues/1347
- Branch: `fix/1347-stepper-focus-flag`
- Worktree: `~/devwork/.projects/apps/cata_club-worktrees/gentleman-1347`
- TDD: strict, on (per project CLAUDE.md and task brief) — runner `cd frontend && pnpm vitest run <file>`
- RDD: on (per project convention) — not exercised in this session; single writer, no push/PR/review opened per task scope

## Scope

Four advisory findings from the native review of PR #1346 (issue #1332, lineage
`review-d5c21ef1983f0163`). The PR was approved; these close separately.

## Tasks

- [x] **1. One-shot focus flag's real lifetime** (R2-001/R3-002/R4-001,
      `frontend/src/app/student/enroll/page.tsx` ~294-327)
  - Extracted pure guard `shouldFocusStepHeadingOnJump(destination, current)`
    into `enroll-utils.ts` — `destination !== current`.
  - `handleStepperJump` now only arms the flag when the jump actually changes
    the step; `goToStep` already no-ops on a same-step target
    (`wizard-history.ts:131`), so the flag can no longer be left armed for a
    future ordinary navigation to consume by accident.
  - Renamed `focusStepHeadingOnNextRender` → `focusStepHeadingOnNextStepChange`
    and rewrote its doc comment to state the real lifetime (consumed the next
    time `step` changes, not "on next render").
  - TDD evidence: added `shouldFocusStepHeadingOnJump` unit tests in
    `enroll-utils.test.ts` BEFORE the export existed — RED:
    `TypeError: shouldFocusStepHeadingOnJump is not a function` (both cases).
    Implemented the export — GREEN (18/18 in that file).

- [x] **2. Negative-side focus tests** (R3-001,
      `frontend/src/app/student/enroll/__tests__/EnrollPage.test.tsx`)
  - Added "keeps focus on the Siguiente button for the step change right
    after a jump" and "never moves focus to a step heading on plain forward
    navigation".
  - Verified both tests actually bite (team convention: invert the predicate)
    by temporarily reintroducing two different regressions and observing RED,
    then reverting to the fixed code and observing GREEN:
    - Removed the `.current = false` reset in the consuming effect → test 1
      failed (`activeElement` was the heading, not the button).
    - Armed the flag unconditionally inside `handleNext` → test 2 failed
      (`activeElement` was the heading after a plain "Siguiente").
  - GREEN with the real code: 61/61 in `EnrollPage.test.tsx`.
  - Note: item 1's exact edge case (a jump whose destination equals the
    current step) stays unreachable through today's `Stepper` — only a DONE
    step is ever clickable, and a done step is never the current one — so it
    is covered by the item-1 unit test instead, per the issue's own text.

- [x] **3. Rename "píldora compacta" → "punto/dot"** (R2-002,
      `frontend/src/components/ui/__tests__/Stepper.test.tsx` ~213)
  - Comment-only rename: "la píldora compacta completada" → "el punto
    compacto completado" (Spanish, matching the file). No behavior change,
    no new test needed.

- [x] **4. Parity test compares `clickable`, not just `data-state`** (R3-003,
      `frontend/src/components/ui/__tests__/Stepper.test.tsx` ~159-173)
  - Added "agrees on which steps are clickable between the wide pill and the
    compact dot" next to the existing `data-state` parity test — compares the
    SET of clickable indices (button vs span) between the wide `<ol>` and the
    compact row.
  - Verified it bites: temporarily diverged the compact render's `clickable`
    derivation from the shared one (`clickable || (active && navigable)`) in
    `Stepper.tsx` → RED (`[true,true,true,false,false]` vs
    `[true,true,false,false,false]`). Reverted `Stepper.tsx` to its original
    state (confirmed via `git diff --stat` showing no change) — GREEN
    (25/25 in `Stepper.test.tsx`).

## Verification

- `pnpm vitest run src/app/student/enroll src/components/ui/__tests__/Stepper.test.tsx`
  → 283/283 passed (13 files).
- `make pre-pr LANE=frontend` → see report below.

## Files changed

- `frontend/src/app/student/enroll/enroll-utils.ts` — new pure export
  `shouldFocusStepHeadingOnJump`.
- `frontend/src/app/student/enroll/page.tsx` — rename + guard in
  `handleStepperJump`, doc comment rewrite.
- `frontend/src/app/student/enroll/__tests__/enroll-utils.test.ts` — unit
  tests for the new export.
- `frontend/src/app/student/enroll/__tests__/EnrollPage.test.tsx` — two
  negative-side focus tests.
- `frontend/src/components/ui/__tests__/Stepper.test.tsx` — comment rename
  (item 3) + clickable-parity test (item 4). `Stepper.tsx` itself unchanged.

## Next

Left for the user: push the branch, open the PR (`Closes #1347`... — not a
bug fix per Conventional Commits definition, no issue-link requirement per
project CLAUDE.md since this is `chore`/advisory follow-up, not a bug fix),
run `make pre-pr LANE=frontend`, and decide on native review per the
user-owned RDD switch. This session did not push, open a PR, or run
`gentle-ai review`, per task instructions.
