# Tasks: Design System v1 — Admin Panel Light-Theme Migration (Track A)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~80 (PR1) → ~450 (PR3/PR9 peak); ~3,200 total across chain |
| 400-line budget risk | High (chain-wide); per-PR risk varies, see table below |
| Chained PRs recommended | Yes |
| Suggested split | 11 PRs, feature-branch-chain (see Work Units) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| PR | Branch (base) | Goal | Est. diff | Risk | Focused test | Runtime harness | Rollback boundary |
|----|---|---|---|---|---|---|---|
| 1 | `fase-0-tokens` (tracker `design-system-migration`) | Add 5 tokens + rewrite 8 shared classes + `.alert-error` + `layout.tsx` | ~80 | Low | `pnpm build` | `pnpm dev`, visual smoke of all 13 views (highest blast radius) | `git revert` PR1 commit; cascades to downstream branches — sign off smoke before PR2 starts |
| 2 | `fase-1-auth` (← PR1) | login/register/forgot-password light + B1/B2 | ~280 | Medium | `pnpm test` (RegisterPage.test.tsx) + `pnpm build` | `pnpm dev`, verify chips/banner on 3 auth screens | `git revert` PR2 only; disjoint from PR1 view set |
| 3 | `fase-2-dashboard-members-groups` (← PR2) | dashboard/members/groups hero+card pattern + B3 | ~450 | High — split into 3a/3b by view if measured diff confirms | `pnpm test` (groups-page-utils) + `pnpm build` | `pnpm dev`, verify shared pattern + badges on 3 views | `git revert` PR3; capacity-bar function untouched |
| 4 | `fase-3a-payments-hero` (← PR3) | payments hero + summary cards | ~350 | Medium-High | `pnpm build` | `pnpm dev`, visual check payments top section | `git revert` PR4; payments table section unaffected |
| 5 | `fase-3b-payments-table-attendance` (← PR4) | payments table+badges (B4) + attendance | ~420 | High — split attendance into its own PR if measured diff confirms | `pnpm build` | `pnpm dev`, verify status badges readable by text alone | `git revert` PR5 |
| 6 | `fase-4-trainer` (← PR5) | trainer/page.tsx light + hero/card reuse | ~250 | Low-Medium | `pnpm build` | `pnpm dev`, visual check trainer view | `git revert` PR6 |
| 7 | `fase-4b-trainer-attendance` (← PR6, conditional) | trainer/attendance hero+table split (mirrors PR4/5) | ~420 | High | `pnpm build` | `pnpm dev`, verify badge parity vs `attendance/page.tsx` | `git revert` PR7 |
| 8 | `fase-5a-student-hero` (← PR7) | student + student/enroll hero/summary sections | ~350 | Medium | `pnpm build` | `pnpm dev`, visual check both hero sections | `git revert` PR8 |
| 9 | `fase-5b-student-table` (← PR8) | student + student/enroll tables/lists+badges | ~400 | High | `pnpm build` | `pnpm dev`, verify list/badge tokens on both views | `git revert` PR9 |
| 10 | `fase-5c-student-enroll-form` (← PR9) | student/enroll multi-step form panels only | ~350 (measured: 188) | Medium-High | `pnpm build` | `pnpm dev`, walk enroll form steps, verify no `cata-dark`/`cata-navy` remain | `git revert` PR10 |
| 11 | `fase-6-qa` (← PR10) | Palette/contrast/breakpoint audit + fixes; tracker merges to `main` after | Variable (fixes only) | Low-Medium | `pnpm test` + `pnpm build` | `pnpm dev`, mobile/tablet/desktop pass on all 13 views | `git revert` PR11; tracker merge is the final, separately revertible step |

PRs 3, 5, 7, 9 carry High risk because they combine hero+table+badge work across large files; each names an explicit fallback sub-split (3a/3b already planned; 5→attendance-only fallback; trainer/attendance split at PR7 boundary if needed) to keep the actual diff under 400 once measured. No further decision needed before apply — `auto-chain` proceeds with PR1 first.

## Phase 0: Foundation Tokens — PR1 `fase-0-tokens` (target: tracker)

- [x] 0.1 `tailwind.config.ts`: add `cata.bg #F9FAFB`, `cata.surface #FFFFFF`, `cata.text #1F2937`, overwrite `cata.border #E5E7EB`, add `cata.state-ok #15803D`
- [x] 0.2 `globals.css`: rewrite `.card`/`.card-hover` values to `bg-cata-surface`/`border-cata-border` + `shadow-card`/`shadow-elevated`
- [x] 0.3 `globals.css`: rewrite `.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.input-field` to light token values
- [x] 0.4 `globals.css`: rewrite `.badge-success`/`.badge-warning`/`.badge-error`/`.badge-neutral`; success → `state-ok`
- [x] 0.5 `globals.css`: add new `.alert-error` (login's `role="alert"` + icon shape, `rounded-lg border px-3 py-2 text-xs`)
- [x] 0.6 `layout.tsx`: `body` class `bg-cata-dark`→`bg-cata-bg`, `text-white`→`text-cata-text`
- [x] 0.7 `pnpm build` passes (no meaningful unit-test surface for pure CSS/token value swaps — TDD carve-out per config, verified via build + manual smoke instead)
- [x] 0.8 Manual smoke: all 13 views render without visual breakage before PR2 starts (11/13 depend on these shared classes) — verified via Playwright screenshot of `/login` (body #F9FAFB, text #1F2937 confirmed computed) + HTTP 200 sweep of all 13 routes + `/products` 307 redirect, zero console errors

## Phase 1: Auth Screens (B1, B2) — PR2 `fase-1-auth` (target: fase-0-tokens)

- [x] 1.1 `login/page.tsx`: replace `cata-dark`/`cata-navy` classes with light tokens
- [x] 1.2 `login/page.tsx`: fix B1 — demo-role chips use only declared `cata-*` colors
- [x] 1.3 `login/page.tsx`: fix B2 — replace inline error banner with shared `.alert-error`
- [x] 1.4 `register/page.tsx`: replace `cata-dark`/`cata-navy` with light tokens
- [x] 1.5 `register/page.tsx`: fix B2 — adopt `.alert-error` (drop bare `<p>` banner)
- [x] 1.6 `forgot-password/page.tsx`: replace `cata-dark`/`cata-navy` with light tokens
- [x] 1.7 RED: add/update `RegisterPage.test.tsx` assertion covering the shared `.alert-error` banner (fails against old markup); GREEN once 1.4/1.5 land — see Deviations, the pre-existing suite had no dark-class-string assertions to convert, so a new RED test was authored instead
- [x] 1.8 `pnpm test` + `pnpm build` — done and passing (429/429 tests, clean build). Manual smoke of 3 auth screens — left for orchestrator (not run by this agent)

## Phase 2: Core Views Hero+Card Pattern (B3) — PR3 `fase-2-dashboard-members-groups` (target: fase-1-auth)

- [x] 2.1 `dashboard/page.tsx`: establish canonical hero-band pattern (replaces `bg-cata-navy` block, ~line 95)
- [x] 2.2 `dashboard/page.tsx`: remaining `bg-cata-dark-elevated` cards → light card pattern
- [x] 2.3 `members/page.tsx`: reuse hero pattern (~line 320) + table/card light tokens
- [x] 2.4 `groups/page.tsx`: reuse hero pattern (~line 157) + footer cards (~line 602) light tokens
- [x] 2.5 `groups/page.tsx`: fix B3 — group-level badges → `cata-*` tokens (no hardcoded hex/rgba)
- [x] 2.6 RED: add/confirm `groups-page-utils` test asserting capacity-bar color output is byte-identical before/after this phase
- [x] 2.7 GREEN: verify 2.6 passes with zero diff to capacity-bar functions
- [x] 2.8 `pnpm test` (430/430 passed) + `pnpm build` (clean, 18 routes) — done. Measured diff: 303 changed lines total (dashboard 48, members 82, groups 114, groups-page-utils.ts 16, groups-page-utils.test.ts 43), under the 400-line budget — no 2a/2b split needed. Manual smoke — left for orchestrator (not run by this agent)

## Phase 3: Payments/Attendance Table+Badge Pattern (B4)

### PR4 `fase-3a-payments-hero` (target: fase-2-...)
- [x] 3a.1 `payments/page.tsx`: hero band + summary/stat cards → light hero pattern (reused from Phase 2)
- [x] 3a.2 `pnpm build` — done and clean (18 routes). Manual smoke of payments top section — left for orchestrator (not run by this agent)

### PR5 `fase-3b-payments-table-attendance` (target: fase-3a-...)
- [x] 3b.1 `payments/page.tsx`: remaining table + status badges → light tokens
- [x] 3b.2 `payments/page.tsx`: fix B4 — paid/pending/overdue badges → `state-ok`/equivalent; verify text-only distinguishability + WCAG AA red-on-white — confirmed `validationStatusStyles`/`membershipStatusStyles` already resolve through PR1's `.badge-success` (`state-ok #15803D`)/`.badge-warning`/`.badge-error`; text labels ("Pendiente"/"Validado"/"Rechazado") untouched
- [x] 3b.3 `attendance/page.tsx`: hero+table light tokens + B4 status badges → `state-ok` (measured combined diff 332 lines, under the 400-450 budget — no split needed)
- [x] 3b.4 `pnpm build` (clean, 18 routes) + `pnpm test` (436/436 passed). Manual smoke — left for orchestrator (not run by this agent)

## Phase 4: Trainer Views Reuse Validated Pattern

### PR6 `fase-4-trainer` (target: fase-3b-...)
- [x] 4.1 `trainer/page.tsx`: light tokens, reuse hero+card pattern — also found and fixed 2 hardcoded dark-theme color-mapping Records (`attendanceBadgeStyles`, `levelBadge`); reused `getAttendanceBadgeTokens` from `attendance/attendance-utils.ts` (Fase 3b) and added new `getLevelBadgeTokens` pure function to `lib/groups-utils.ts` (RED-GREEN, see below)
- [x] 4.2 `pnpm test` (441/441 passed) + `pnpm build` (clean, 18 routes). Measured diff: 166 changed lines (116 insertions/50 deletions across 3 files), well under the ~250 estimate. Manual smoke — left for orchestrator (not run by this agent)

### PR7 `fase-4b-trainer-attendance` (target: fase-4-trainer, conditional on diff size)
- [x] 4.3 `trainer/attendance/page.tsx`: hero+table light tokens, reusing PR6's hero pattern; measured combined diff 188 changed lines (85 insertions/103 deletions across 2 files) — well under the 420-line estimate, no split needed
- [x] 4.4 Verify badge/status token usage is identical to `attendance/page.tsx` (spec scenario) — found the local `trainer/attendance/attendance-utils.ts` duplicated two color-mapping Records (`ATTENDANCE_BADGE_STYLES`, near-miss on "present" token vs `state-ok`; local `LEVEL_BADGE` in page.tsx, dark rgba duplicate of PR6's `getLevelBadgeTokens`). Deleted both and imported the already-tested shared functions (`getAttendanceBadgeTokens` from `src/app/attendance/attendance-utils.ts`, `getLevelBadgeTokens` from `src/lib/groups-utils.ts`) directly — case-3 reuse per PR6's precedent, no new tests needed since the functions are already fully tested. The desktop quick-select "active" button (`ATTENDANCE_CARD_STYLES`, a bordered-button variant with no counterpart in `attendance/page.tsx`) was also collapsed into `getAttendanceBadgeTokens(...).badgeClass` + a generic `border-current/20` treatment instead of keeping a second hardcoded Record, guaranteeing byte-identical colors between trainer's toggle and the admin badge for all 4 states
- [x] 4.5 `pnpm build` (clean, 18 routes) + `pnpm test` (441/441 passed). Manual smoke — left for orchestrator (not run by this agent)

## Phase 5: Student Views Reuse Validated Pattern

### PR8 `fase-5a-student-hero` (target: fase-4b/fase-4-...)
- [x] 5a.1 `student/page.tsx`: hero + profile/summary cards → light tokens — migrated Hero Banner, account-type badge, student selector, enrollment CTAs, pre-enrollment membership plan cards, demo scenario selector, and membership/payment summary cards; stopped exactly before "Próximas Sesiones" list section (PR9 scope). Found one real conditional color-mapping (proof-status text color, previously an inline ternary over `amber-400`/`emerald-400`/`cata-red`) — extracted to a new pure `getProofStatusColorClass` in `proof-utils.ts` with RED-GREEN tests instead of inlining a new Record, per the brand-color discipline note
- [x] 5a.2 `student/enroll/page.tsx`: hero + summary section → light tokens — migrated the "Inscripción Completada" confirmation/summary screen and the Hero Banner; stopped before the Progress bar (step indicator), leaving it + the demo-helper quick-fill box + the form-card wrapper for PR10 (multi-step form panels)
- [x] 5a.3 `pnpm build` (clean, 18 routes) + `pnpm test` (445/445 passed, incl. 4 new `getProofStatusColorClass` tests). Measured diff: 184 changed lines (110 insertions/74 deletions across 4 files: student/page.tsx, student/enroll/page.tsx, student/proof-utils.ts, student/__tests__/proof-utils.test.ts) — well under the ~350 estimate. Manual smoke of both hero sections — left for orchestrator (not run by this agent)

### PR9 `fase-5b-student-table` (target: fase-5a-...)
- [x] 5b.1 `student/page.tsx`: tables/lists + badges → light tokens — migrated the "Próximas Sesiones" session-card list (`text-white`→`text-cata-text` family), the "Domain model info card" (`border-white/8 bg-cata-dark-elevated`→`border-cata-border bg-cata-bg`, matching the identical info-card pattern already used at line 605 and in `attendance/page.tsx:344`), and the demo-honesty footer (`text-white/30`→`text-cata-text/30`, matching `dashboard/page.tsx`'s identical footer). No conditional color-mapping logic found in this range (pure className swaps) — TDD carve-out applies, no RED-GREEN needed. File is now fully free of `cata-dark`/`cata-navy`/`text-white`/`bg-white`/`border-white` classes (verified via grep)
- [x] 5b.2 `student/enroll/page.tsx`: lists + badges → light tokens — **no additional scope**: every remaining dark-token block in this file (Progress bar, demo quick-fill helper box, and the entire `<div className="card">` form wrapper containing `<form>` + all `renderTypeStep/renderPersonalStep/renderClubStep/renderHealthStep/renderSummary()` panels, including the review/summary step's dt/dl list) is part of PR10's "multi-step form panels" scope per PR8's documented boundary (stopped right after the Hero Banner, before the Progress bar comment). Confirmed no standalone list/badge content exists outside those form panels — correctly leaving 100% of this file's remaining dark markup for 5c.1
- [x] 5b.3 `pnpm build` (clean, 18 routes) + `pnpm test` (445/445 passed). Measured diff: 24 changed lines (12 insertions/12 deletions, 1 file: student/page.tsx only) — far under the ~400 estimate, no split needed. Manual smoke — left for orchestrator (not run by this agent)

### PR10 `fase-5c-student-enroll-form` (target: fase-5b-...)
- [x] 5c.1 `student/enroll/page.tsx`: multi-step form panels → light tokens (`.input-field`/`.card`) — migrated the Progress bar (step indicator + track, reusing the exact `h-1.5 overflow-hidden rounded-full bg-cata-border` pattern from `groups/page.tsx`/`trainer/attendance/page.tsx`), the demo quick-fill helper box (reusing student/page.tsx's `border-2 border-dashed border-cata-border bg-cata-bg` dashed-box pattern), the form-card wrapper, and all step render functions (`renderInput`/`renderTextarea`/`renderTypeStep`/`renderPersonalStep`/`renderClubStep`/`renderHealthStep`/`renderSummary`). Pure className swaps — zero logic touched (`calculateAge.ts`/`validateEnrollStep.ts` untouched, their existing tests still pass unmodified, so the TDD carve-out applies). Brand-color discipline: reused established codebase precedents for every color swap — `border-amber-200 bg-amber-50 text-amber-700` for warning boxes (exact match to `trainer/attendance/page.tsx`'s already-migrated amber alert), `bg-blue-50 text-blue-700` for the "Representante" type icon (matches `student/page.tsx`'s existing blue badge convention), and extended that identical light-transform rule (900/20→50, 500/30→200, 400→700, 400/80→700/80) to the file's own pre-existing `emerald-*`/`purple-*` alert boxes for consistency (no new hues invented, no plain-Tailwind color introduced for anything with brand/status meaning beyond what the rest of the app already established for non-critical info/warning boxes — the `cata-*` semantic system, `LEVEL_BADGE`/`getAttendanceBadgeTokens`/`getLevelBadgeTokens`/`getProofStatusColorClass`, was not touched or duplicated since none of this file's content is level/attendance/proof-status domain)
- [x] 5c.2 Verify no `cata-dark`/`cata-navy` classes remain in either student file (spec scenario) — confirmed via `rg -P "cata-dark|cata-navy|text-white|border-white|bg-white(?!/)"` returning zero matches in both `src/app/student/page.tsx` and `src/app/student/enroll/page.tsx`
- [x] 5c.3 `pnpm build` (clean, 18 routes) + `pnpm test` (445/445 passed, no new tests needed — no new logic introduced). Measured diff: 188 changed lines (94 insertions/94 deletions, 1 file), well under the ~350 estimate and the 400-420 stop threshold. Manual smoke of full enroll flow — left for orchestrator (not run by this agent)

## Phase 6: Cross-Cutting QA — PR11 `fase-6-qa` (target: fase-5c-...)

- [x] 6.1 Palette audit: grep all 13 views for hex/rgba outside declared `cata-*` tokens; fix any found — found and fixed one genuine leftover: `globals.css` base-layer `body` rule still hardcoded `#0A0A12`/`#FFFFFF` (dead code masked by `layout.tsx`'s higher-specificity `bg-cata-bg`/`text-cata-text` utility classes, but a real off-palette leftover); rewrote to `#F9FAFB`/`#1F2937` and updated the stale "Dark Theme" comment header. All other hex/rgba occurrences reviewed and confirmed non-violations: `.card`/`.btn-*`/`.input-field`/`.badge-*`/`.alert-error` hex values in `globals.css` are Phase-0-approved literal token values (design.md decision); `rgba(139,26,26,x)` hero radial-gradient decorative overlays across 9 views are the declared `cata-red` at low alpha, consistently reused; `login/page.tsx`'s `bg-cata-navy/8 text-cata-navy` demo chip is a declared, documented B1-fix token (not a dark-theme leftover). Plain-Tailwind `blue-50/700`, `emerald-50/700`, `violet-50/700`, `purple-50/700` usages in `student/page.tsx`, `student/enroll/page.tsx`, `dashboard/page.tsx`, `trainer/attendance/page.tsx`, and the canonical `attendance/attendance-utils.ts` `ATTENDANCE_BADGE_TOKENS` are an established, code-documented `-50`/`-700` semantic idiom (same pairing as amber/red), predating this QA phase — not genuinely new/arbitrary, left as-is. `groups-page-utils.ts` capacity-bar `red/amber/emerald-500` fills are explicitly spec-protected ("MUST NOT change") and untouched. `Header.tsx`'s `amber-500/20`/`amber-400` "Demo" badge sits on the intentionally-dark persistent nav bar (out of migration scope, correct contrast direction for a dark bg). Root `src/app/page.tsx` (institutional landing page) confirmed out of scope — separate design track, deliberately dark per commit bf20d44
- [x] 6.2 Contrast check: red-bg elements pair white text; verify globally (yellow n/a — none in this scope, confirmed via grep) — `.btn-primary` (`#8B1A1A` bg + white text) computed contrast ~9.3:1, passes AA. `.badge-error`/`.alert-error`/page-level `bg-red-50 text-red-700` pairs (light red tint + dark red text) computed ~5.9:1, passes AA. `.badge-warning`/page-level `bg-amber-50 text-amber-700` pairs verified dark-on-light, no white-on-amber found anywhere. `.badge-neutral`/`.badge-success` verified high contrast. The 4 `bg-amber-700` hits in `payments/page.tsx` (lines 531-543) are 1px decorative bullet dots inside an `amber-50` card, not text-on-background — not a contrast concern. No red/amber background paired with wrong-direction text found
- [x] 6.3 Confirm `products/page.tsx` untouched, redirect-only (spec scenario) — confirmed via `git log --follow`: last commit touching the file is `1d53e79` (pre-dates `design-system-migration` entirely); file is still the 11-line `redirect("/payments")` stub, zero light-theme classes
- [x] 6.4 Mobile/tablet/desktop manual pass on all 13 views; log and fix issues found (no new pattern) — code-review pass (live breakpoint screenshots left to orchestrator per instructions): no hardcoded fixed-pixel widths that would break mobile collapse found, except `trainer/page.tsx`'s roster `<table className="w-full text-sm min-w-[300px]">` which is correctly wrapped in `overflow-x-auto` (intentional min-width-then-scroll pattern, not a bug). All 4 `<table>` elements (`members`, `payments`, `attendance`, `trainer`) confirmed wrapped in `.card overflow-hidden > overflow-x-auto`. All multi-column `grid-cols-N` usages use `sm:`/`md:`/`lg:` responsive prefixes except five `<dl className="grid grid-cols-2 ...">` label/value summary pairs in `student/enroll/page.tsx` review step and `trainer/attendance/page.tsx` — reviewed and judged acceptable (labels wrap gracefully on narrow viewports, no truncation/clipping/overflow, common definition-list pattern); flagging for the orchestrator's live-screenshot pass to confirm rather than changing untested. No other broken responsive patterns found
- [x] 6.5 `pnpm test` (445/445 passed) + `pnpm build` (clean, 18 routes) — both green on `fase-6-qa`. Tracker merge to `main` is an orchestrator/user action, not performed by this agent
