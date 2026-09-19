# 1332 — Stepper follow-ups from the #1331 native review

Issue: https://github.com/AlejandroTatum/cata_club/issues/1332
Branch: `chore/1332-stepper-review-followups` (worktree `cata_club-worktrees/gentleman-1332`, cut from `origin/main` @ a0f9b8a)
Delivery strategy: single PR, squash auto-merge (forecast ~250 changed lines across 5 files, all tests + one small focus-management addition)
TDD: **on** (strict, session config). Runner: `cd frontend && pnpm vitest run <file>`; E2E: `cd frontend && pnpm exec playwright test tests/e2e/enroll-qa.spec.ts -g "<title>"` (managed webServer: builds and boots a production Next.js server per run, ~50s).
RDD: orchestrator-owned; not run by this writer.

## Objective

Close the 6 advisory (non-blocking) findings the native review of #1331 (the navigable Stepper) left behind — issue #1321, lineage `review-f50913ea730bf80f`. The PR was already approved; these are follow-ups, worked in the issue's stated order of impact.

## Findings (from the issue)

- **R4-001** — compact-phone completed dots are `<button>` of `h-2 w-2` (8px) with `gap-1.5`, on the one breakpoint where they exist (touch). Fix: grow the hit area, keep the 8px visual mark, test the button's box.
- **R2-001** — `position`/`done`/`active`/`clickable` computed twice, once per render (wide pills, compact dots). Extract one derivation feeding both.
- **R3-001** — activating a completed pill turns it into a `<span>`; focus falls to `<body>`. Move focus to the destination step, with a test.
- **R2-002/R3-004** — N03's `toHaveCount(0)` by name passes even if the label changes or the step doesn't render. Assert positively that the completed pill IS a button and the following ones are not.
- **R3-003** — no test proves `showCount` on step 2+ says "Paso 2 de N · Label".
- **R3-002** — both renders (wide pills, compact dots) always live in the DOM; a completed step yields two buttons in unscoped queries.

## Design decisions

- **R4-001 sizing: `h-6 w-6` (24px square), not `MIN_TARGET_CLASS` (`min-h-[24px]`).** The issue names both the project floor (`MIN_TARGET_CLASS`, 24px, AA) and what's "reasonable" on mobile (44px, AAA — the separate promise `touch-target-usage.test.ts`'s `@touch-target` roster guards for `AppShell`, `HelpChatDock`, `AttendanceRosterRow`, the landing). `target-size.ts`'s own doc comment documents an explicit exception for `MIN_TARGET_CLASS`: "height only… An icon-only control needs a square (`h-6 w-6`…), not this." The dot is icon-only (no text), so the square carve-out applies, not the height-only class — same reasoning already used for `EnrollPage`'s own confirmation checkbox (`h-6 w-6`, `EnrollPage.test.tsx:768`). Growing every completed dot to the full 44px `@touch-target` promise would also blow up a row explicitly built to stay compact next to 8-10px siblings, adding a new marked surface + roster-count maintenance burden the issue never asked for. Verified with `rg` before choosing: `lib/target-size.ts`, `lib/__tests__/touch-target-usage.test.ts` (roster + `@touch-target` grep), `app/student/enroll/page.tsx:1230` (checkbox), `app/login/page.tsx:437` (toggle).
- **R3-001 focus target: the step's own `<h2>{STEP_LABELS[step]}</h2>`** (`data-testid="enroll-wizard-card"` block), not the Stepper's own re-activated span. It's the one heading that already names every destination step correctly and is what N01-N03 already assert on in Playwright (`getByRole("heading", { name: /datos del estudiante/i })`). The wizard-header eyebrow (`"Paso N de M"`) was rejected as a target: it never includes the step's name and two EnrollPage tests already pin its exact text (`"Paso 2 de 5"`), so touching it risked scope creep into unrelated assertions. `tabIndex={-1}` keeps it out of the Tab order; focus is set from a `useEffect` keyed on `step` (not inline in the click handler) so it runs after the heading's text has already re-rendered for the destination step, and a one-shot ref flag scopes the behavior to Stepper-originated jumps only — ordinary `handleNext`/`handleBack` navigation is untouched.
- **R3-002: documented, not gated.** A `matchMedia`/prop toggle to render only one layout was rejected: it adds runtime branching and a new prop surface for a problem that tests already avoid by construction — the wide pill's accessible name ("Estudiante") and the compact dot's ("Volver a Estudiante") never collide, and N03 itself already scopes to `page.getByRole("list", ...)`, which is the `<ol>` alone and never reaches the compact `<div data-testid="stepper-compact">` sibling. Documented instead with an explicit regression test (`Stepper.test.tsx`, "both renders coexist in the DOM") that scopes queries per container and asserts the two accessible names, so a future test that accidentally queries unscoped fails loudly instead of silently double-counting.

## Scope (authorized)

- Edit: `frontend/src/components/ui/Stepper.tsx`, `frontend/src/components/ui/__tests__/Stepper.test.tsx`, `frontend/src/app/student/enroll/page.tsx`, `frontend/src/app/student/enroll/__tests__/EnrollPage.test.tsx`, `frontend/tests/e2e/enroll-qa.spec.ts`.
- No backend changes, no new dependencies, no other worktrees touched.
- Code/tests/comments in English; UI copy (none changed) stays Spanish.

## Tasks

- [x] T1 (R4-001): 24px touch target around the compact dot's 8px visual mark, test-first.
- [x] T2 (R2-001): `deriveStepState()` extracted, fed to both renders, parity test.
- [x] T3 (R3-002): documented dual-render selection pattern with a regression test (no `matchMedia` gate — see Design decisions).
- [x] T4 (R3-001): focus moved to the destination step heading after a stepper jump, test-first.
- [x] T5 (R2-002/R3-004): N03 rewritten to assert navigability positively.
- [x] T6 (R3-003): `showCount` on step 2+ covered through `EnrollPage`.
- [x] T7: verification — focused Vitest files, focused Playwright N03, then `make pre-pr LANE=frontend`; one work-unit commit per finding group.

## Acceptance criteria

- Compact dots meet a documented touch minimum with a test (24px square, `h-6 w-6`, icon-only carve-out of `MIN_TARGET_CLASS`).
- Per-step state (`position`/`done`/`active`/`clickable`) derived in exactly one place, both renders proven to agree.
- N03 asserts the navigable behavior positively (the completed pill IS a button, the rest are not, while visible).

## Evidence

### T1 (R4-001) — `Stepper.test.tsx`

- **RED** — `cd frontend && pnpm vitest run src/components/ui/__tests__/Stepper.test.tsx` → 1 failed / 22 passed. `AssertionError: expected 'rounded-full h-2 w-2 bg-state-ok' to match /\bh-6\b/` at `Stepper.test.tsx:204` ("gives a completed dot a 24px square hit area around its 8px visual dot").
- **GREEN** — same command → 24 passed (0 failed).
- Change: `Stepper.tsx`'s compact-dot `<button>` now renders `flex h-6 w-6 flex-none items-center justify-center` with a nested `<span>` carrying the original 8/10px visual classes; non-interactive dots (`<span>` siblings) are unchanged.

### T2 (R2-001) — `Stepper.tsx` / `Stepper.test.tsx`

- **RED**: not independently reproducible — the two inline derivations already agreed before the refactor (no bug), so the new parity test ("agrees on data-state between the wide pill and the compact dot for every step") passed immediately against the pre-refactor code too. Verified the refactor didn't regress it instead: full suite green before and after the extraction.
- **GREEN** — `pnpm vitest run src/components/ui/__tests__/Stepper.test.tsx` → 24 passed, including the parity test and all pre-existing state/semantics tests.
- Change: `deriveStepState(index, current, navigable)` added, used by both the `<ol>` pill loop and the compact-dot loop; both local re-declarations of `position`/`done`/`active`/`clickable` removed.

### T3 (R3-002) — `Stepper.test.tsx`

- Documentation-only via test, not a bug fix: no RED phase (behavior already correct — see Design decisions). Added "both renders coexist in the DOM" test, scoped with `within(wideList())` / `within(compactRow())`, asserting 2 buttons per container and the two distinct accessible names ("Estudiante" vs "Volver a Estudiante").
- **GREEN** — same full-suite run, 24 passed.

### T4 (R3-001) — `page.tsx` / `EnrollPage.test.tsx`

- **RED** — `pnpm vitest run src/app/student/enroll/__tests__/EnrollPage.test.tsx -t "moves focus to the destination step heading"` → 1 failed. `expect(document.activeElement).toBe(...)` — received `<body>`, expected the "Datos del estudiante" `<h2>`.
- **GREEN** — `pnpm vitest run src/app/student/enroll/__tests__/EnrollPage.test.tsx` → 58 passed (was 57; +1 new).
- Change: `stepHeadingRef` + `tabIndex={-1}` on the step `<h2>`; `focusStepHeadingOnNextRender` one-shot ref flag set only in a new `handleStepperJump(index)`, consumed by a `useEffect` keyed on `step`; `Stepper`'s `onStepClick` now calls `handleStepperJump` instead of `goToStep` directly.

### T5 (R2-002/R3-004) — `enroll-qa.spec.ts`

- Test-only rewrite of an already-passing assertion into a stronger positive one; no application code changed, so no RED phase applies (same class as T3).
- **GREEN** — `pnpm exec playwright test tests/e2e/enroll-qa.spec.ts -g "N03"` → 1 passed (52.3s, managed webServer build+boot included).

### T6 (R3-003) — `EnrollPage.test.tsx`

- Coverage-only addition; the behavior (`showCount={!isFirst}`) already existed and was correct, so no RED phase (same class as T3/T5).
- **GREEN** — `pnpm vitest run src/app/student/enroll/__tests__/EnrollPage.test.tsx` → 59 passed (was 58; +1 new, "Paso 2 de 4 · Estudiante").

### T7 — Verification

- Focused files green as recorded above (Stepper.test.tsx 24/24, EnrollPage.test.tsx 59/59, N03 1/1).
- `make pre-pr LANE=frontend` — see report to orchestrator for the observed result (run after this document was drafted; recorded there, not duplicated here to avoid a stale copy).
- Attribution check: `git log --format=%B origin/main..HEAD | rg -c 'Claude|Generated'` → must print 0 before delivery.

### Commits

- `995363d` fix(stepper): grow compact dot touch target and share step derivation
- `11f7827` fix(enroll): restore focus to the step heading after a stepper jump
- `489426b` test(enroll): cover showCount on step 2+ of the compact stepper
- `5645c13` test(e2e): assert N03 navigability positively, not by absence
