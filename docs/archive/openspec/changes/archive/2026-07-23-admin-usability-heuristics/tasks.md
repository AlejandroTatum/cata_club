# Tasks: Admin Panel Usability Heuristics Fixes (Track C)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | PR1 ~260-420 (component ~80 + payments ~70 + groups ~70 + 2 test files ~150) / PR2 ~60-100 / PR3 ~90-140 |
| 400-line budget risk | PR1 Medium-High / PR2 Low / PR3 Low |
| Chained PRs recommended | No (3 PRs already independently mergeable to `main`; PR1 has an internal 1a/1b fallback split, not a chain) |
| Suggested split | PR 1 (with 1a/1b fallback) / PR 2 / PR 3 — all target `main` directly, no ordering dependency |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — only triggered if PR1's pre-PR line count exceeds 400; then split to 1a (`ConfirmDialog` + payments) / 1b (groups), both still independent PRs to `main`, not stacked |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `ConfirmDialog` component + payments approve wiring | PR 1 (1a if split) | `pnpm test src/components/__tests__/ConfirmDialog.test.tsx src/app/payments` | `pnpm build` + manual click-through on `/payments` | Revert `ConfirmDialog.tsx` + `payments/page.tsx` diff; component has no other consumer in this unit |
| 2 | Groups remove-from-group wiring | PR 1 (1b if split) | `pnpm test src/app/groups` | `pnpm build` + manual click-through on `/groups` | Revert `groups/page.tsx` diff only; `ConfirmDialog.tsx` stays if 1a already merged |
| 3 | Dashboard stat/quick-action differentiation + escalation | PR 2 | `pnpm build` (no new unit test; CSS-only) | Manual smoke on `/dashboard` per config CSS carve-out | Revert single-file `dashboard/page.tsx` diff |
| 4 | Consistency pass (enroll alert, forgot-password fidelity, members h2) | PR 3 | `pnpm build` (no new unit test; CSS/markup-only) | Manual smoke on `/student/enroll`, `/forgot-password`, `/members` | Revert per-file; 3 files are independent, each individually revertable |

## PR 1: Action Safety (`ConfirmDialog` + payments approve + groups remove)

> Pre-PR gate: after 1.5-1.7, run a line-count check. If total exceeds 400, split remaining tasks into **PR 1a** (1.1-1.5) and **PR 1b** (1.6-1.7), both merging to `main` independently, no ordering dependency (design.md fallback).

> **Fallback triggered** (2026-07-15): combined diff on `admin-usability-heuristics-pr1` measured 459 changed lines vs `origin/main` (over the 400 budget). Split applied per design.md: **PR 1a** = 1.1-1.6 (`ConfirmDialog` + payments), kept on this branch, final diff 351 lines. **PR 1b** = 1.7-1.9 groups portion, deferred to a separate branch `admin-usability-heuristics-pr1b` (fresh from `origin/main`) and a separate `sdd-apply` pass — not yet applied.

- [x] 1.1 RED: write `src/components/__tests__/ConfirmDialog.test.tsx` — confirm fires `onConfirm` exactly once (spec: Dialog blocks the action until confirmed); cancel/Escape/backdrop never fire it and data stays unchanged (spec: Dialog is dismissible without side effects); focus moves to confirm button on open and returns to trigger on close
- [x] 1.2 GREEN: create `src/components/ConfirmDialog.tsx` implementing `ConfirmDialogProps` (design.md contract: `open`, `title`, `message`, `confirmLabel`, `cancelLabel`, `variant: "state-ok"|"danger"`, `onConfirm`, `onCancel`), `role="dialog" aria-modal="true"`, `aria-labelledby`/`aria-describedby`, focus-trap `useEffect`, Escape/backdrop-click as cancel, Tab/Shift+Tab cycling between the 2 buttons
- [x] 1.3 Map variant → classes per design.md: `state-ok` confirm button `bg-cata-state-ok text-white hover:bg-cata-state-ok/90` + `text-cata-state-ok` heading accent; `danger` confirm button `border-cata-red/30 text-cata-red hover:bg-cata-red/10` (mirrors existing reject styling) + `text-cata-red` heading accent — only existing `cata-*` classes, no `tailwind.config.ts` edit
- [x] 1.4 Run 1.1's test suite to confirm GREEN; run `pnpm test` full suite to confirm no regression
- [x] 1.5 RED: add/adjust a test in `src/app/payments/__tests__/` (create dir if absent) asserting no `updatePaymentValidation`-style mutation fires on "Aprobar Pago" click before confirm, and mutation fires only after confirm click (spec: Approve opens a confirmation before mutating; Canceling approve leaves status unchanged)
- [x] 1.6 GREEN: wire `ConfirmDialog` (`variant="state-ok"`) into `src/app/payments/page.tsx` — restyle approve button from `.btn-primary` to `cata-state-ok`, gate `handleApprove` behind `confirmOpen` state per design.md sequence (click → open dialog → confirm → `handleApprove()` → close, focus returns to trigger)
- [x] 1.7 RED: add a test in `src/app/groups/__tests__/` asserting `handleClearAssignment` does not fire on direct icon click and fires only after `ConfirmDialog` confirm (spec: Remove-from-group opens confirm dialog; Confirming removes the student; Canceling leaves the assignment intact) — **PR 1b**, implemented on `admin-usability-heuristics-pr1b` (isolated worktree, fresh off `origin/main`)
- [x] 1.8 GREEN: wire `ConfirmDialog` (`variant="danger"`, plain click-to-confirm, no typed-reason field) into `src/app/groups/page.tsx` around the existing `handleClearAssignment` — **PR 1b**, done on `admin-usability-heuristics-pr1b`
- [x] 1.9a Verify PR 1a: `tailwind.config.ts` diff is empty; `pnpm test` (463 passed) and `pnpm build` pass on `admin-usability-heuristics-pr1` (ConfirmDialog + payments only). **Merged as PR #18.**
- [x] 1.9b Verify PR 1b: `tailwind.config.ts` diff is empty; `pnpm test` (463 passed) and `pnpm build` pass on `admin-usability-heuristics-pr1b` (groups only). **Not yet opened as a GitHub PR** — because PR 1a hadn't merged yet when 1b was implemented, its worktree had to duplicate `ConfirmDialog.tsx`, pushing the standalone diff to 432 lines (over budget). Open PR 1b only after PR #18 merges to `main`: rebase/redo `admin-usability-heuristics-pr1b` against the new `main`, drop the duplicated `ConfirmDialog.tsx`/its test (already on `main` via #18), keep only `groups/page.tsx` (+38/-1) + `groups/__tests__/GroupsPage.test.tsx` (105 lines) — real diff ~143 lines.

## PR 2: Dashboard Urgency Hierarchy (`src/app/dashboard/page.tsx` only)

- [x] 2.1 Differentiate stat-card container styling from quick-action-card container styling — static `.card` for stats vs `.card-hover` for quick-actions, square vs circular icon wrappers (spec: Stat and quick-action cards read as different content types)
- [x] 2.2 Escalate the 2 `trend: "alert"` stats ("Pendientes de Validar", "Pagos Pendientes") with `border-cata-red/40` + `bg-cata-yellow/10` + bolder icon treatment, DOM order confirmed unchanged (spec: Alert-flagged stat is visually escalated; Card order is unchanged)
- [x] 2.3 Confirmed the other 2 non-flagged stats keep their pre-change baseline styling (spec: Non-flagged stats keep baseline styling)
- [x] 2.4 Verify: `tailwind.config.ts` diff is empty; `pnpm build` passes; `pnpm test` 454/454 pass, no regressions. **Opened as PR #19** (74 changed lines).

## PR 3: Consistency Pass (enroll, forgot-password, members)

- [x] 3.1 Replaced `student/enroll/page.tsx`'s bespoke validation-error box with the shared `.alert-error` class used by `login`/`register` (spec: Enroll validation error uses the shared class)
- [x] 3.2 Rebuilt `forgot-password/page.tsx` as a centered card matching `login`/`register` fidelity; kept it a "coming soon" state with no form/backend call (spec: Forgot-password matches sibling card layout; No functional reset form is introduced)
- [x] 3.3 Added link back to `/login` on `forgot-password/page.tsx` (spec: A way back to login is present)
- [x] 3.4 Inserted a missing `h2` ("Resumen") before the stats grid in `members/page.tsx`, unskipping the heading sequence (spec: Members page has a complete header sequence)
- [x] 3.5 Verify: `tailwind.config.ts` diff is empty; `pnpm build` passes; `pnpm test` 454/454 pass, no regressions. **Opened as PR #20** (73 changed lines).
