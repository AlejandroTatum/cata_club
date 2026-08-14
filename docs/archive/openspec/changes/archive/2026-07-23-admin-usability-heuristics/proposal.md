# Proposal: Admin Panel Usability Heuristics Fixes (Track C)

## Intent

The exploration audit (Nielsen's 10 heuristics, Shneiderman's 8 golden
rules, Sneed's 8 inclusion heuristics) found concrete, file-line-grounded
violations that make the admin panel feel inconsistent and risky to use:
approve/reject actions give no color cue about consequence, destructive
actions fire with zero confirmation, the dashboard doesn't visually
prioritize what needs attention, and several views drift from patterns
already established elsewhere (`.alert-error`, section-header ranks,
auth-screen fidelity). This change fixes those violations using only
already-existing `cata-*` tokens, without touching `tailwind.config.ts` or
the concurrent Track B (vibrant-palette-activation) token work.

## Scope

### In Scope
- Semantic color + confirmation for approve/reject-class actions
  (`payments`) and destructive removal (`groups`), via one new shared
  confirmation-dialog component.
- Dashboard stat-card vs. quick-action visual differentiation, plus
  escalated treatment for the 2 alert-flagged stats.
- Consistency fixes: `student/enroll` reuses `.alert-error` instead of a
  bespoke box; `forgot-password` gains the same centered-card fidelity as
  `login`/`register`; missing `h2` section ranks (e.g. `members`) restored.

### Out of Scope
- `tailwind.config.ts` and any new hex value — only existing `cata-*`
  classes are consumed (hard constraint, Track B isolation).
- Real password-reset flow/backend for `forgot-password` — this is a UI
  fidelity fix only; the page is currently a static "coming soon" stub with
  no form or endpoint.
- Button/Card/Badge/Input component extraction (deferred by Track A).
- Contrast-ratio/click-target live QA — recommend a manual pass in
  `sdd-verify`, per exploration's own risk note.

## Capabilities

### New Capabilities
- `action-safety-confirmation`: shared confirmation-dialog pattern +
  semantic success/danger button treatment for high-consequence actions
  (payments approve, groups remove-from-group).
- `dashboard-urgency-hierarchy`: visual contract distinguishing
  informational stat cards from actionable quick-action cards, with
  escalated styling for alert-flagged stats.
- `admin-consistency-baseline`: shared `.alert-error` usage, consistent
  `h2` section-header rank, and auth-screen fidelity parity across views.

### Modified Capabilities
- None — `openspec/specs/` is currently empty (no prior capability specs
  were committed).

## Approach

Three independently mergeable PRs, each targeting `main` directly (no
tracker/stacked branch, per last week's squash-merge ancestry problem).
No PR depends on another PR in this change being merged first.

| PR | Scope | Files |
|---|---|---|
| **PR 1 — Action safety** | New `ConfirmDialog` component; wire into payments approve (state-ok color + confirm step, matching reject's existing friction) and groups remove-from-group (danger color + confirm) | `src/components/ConfirmDialog.tsx` (new), `src/app/payments/page.tsx`, `src/app/groups/page.tsx` |
| **PR 2 — Dashboard hierarchy** | Differentiate stat vs. quick-action cards; escalate the 2 alert-flagged stats beyond the current small corner badge, using existing `cata-yellow`/`cata-red` tokens | `src/app/dashboard/page.tsx` |
| **PR 3 — Consistency pass** | `.alert-error` reuse in enroll + step-header rank fix; `forgot-password` card-fidelity rebuild; add missing `h2` (e.g. `members`) | `src/app/student/enroll/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/members/page.tsx` |

Each PR is scoped to stay under the 400-changed-line budget; PR 1 is the
largest (new component + 2 consumers) and gets a pre-PR line-count check
before opening.

## Affected Areas

| Area | Impact | PR |
|---|---|---|
| `src/components/ConfirmDialog.tsx` | New | 1 |
| `src/app/payments/page.tsx` | Modified | 1 |
| `src/app/groups/page.tsx` | Modified | 1 |
| `src/app/dashboard/page.tsx` | Modified | 2 |
| `src/app/student/enroll/page.tsx` | Modified | 3 |
| `src/app/forgot-password/page.tsx` | Modified | 3 |
| `src/app/members/page.tsx` | Modified | 3 |
| `tailwind.config.ts` | **Untouched** | — |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Track B (vibrant-palette-activation) touches the same 9 files with an unrelated decorative-gradient edit, in parallel | High | Coordination risk only, not code overlap on the lines this change edits (different sections); merge order handled manually outside this document |
| `cata-state-ok`/`cata-red` tokens renamed or removed by Track B before this merges | Low | Confirm tokens still exist in `tailwind.config.ts` immediately before opening each PR |
| PR 1 exceeds 400-line budget (new component + 2 consumers) | Med | Line-count check before PR open; if exceeded, split into PR 1a (component + payments) and PR 1b (groups) — still independently mergeable, no ordering dependency |
| Confirmation-dialog UX diverges from payments' existing reject pattern (typed reason vs. plain confirm) | Med | Resolve in the open question below before `sdd-spec` |

## Rollback Plan

Each PR is `git revert`-able independently since the three PRs touch
disjoint file sets (only `groups/page.tsx` and `payments/page.tsx` in PR 1
share the new `ConfirmDialog` import — reverting PR 1 removes both
consumers and the component together, cleanly). No PR alters shared config
or global CSS tokens, so a revert of any single PR has no blast radius on
the other two.

## Dependencies

- None blocking. Parallel awareness of Track B's concurrent edits to the
  same 9 files (different lines) — no functional dependency, coordination
  only.

## Success Criteria

- [ ] Payments approve uses `cata-state-ok` styling and requires the same
      confirmation step as reject.
- [ ] Groups remove-from-group requires confirmation before firing.
- [ ] Dashboard visually distinguishes stat cards from quick-actions, and
      the 2 alert-flagged stats read as higher-priority than the other 2.
- [ ] `student/enroll` validation errors use `.alert-error`.
- [ ] `forgot-password` matches login/register card fidelity (still a
      "coming soon" state, now with a way back).
- [ ] All views have a complete, unskipped header rank sequence.
- [ ] `pnpm test` and `pnpm build` pass after each of the 3 PRs.
- [ ] `tailwind.config.ts` diff is empty across all 3 PRs.

## Proposal question round

These weren't resolved by the exploration (which is intentionally
solution-agnostic) and shape PR 1's implementation:

1. Should the new destructive-action confirmation (groups remove-from-group)
   require a typed reason like payments' reject flow, or is a plain
   click-to-confirm modal enough? Exploration frames reject's typed-reason
   as the stronger pattern, but that may be overkill for a low-stakes
   roster edit.
2. For the dashboard urgency escalation, is a stronger visual treatment
   (larger card, bolder border/icon color) sufficient, or does "pendientes
   de validar" need a hard visual priority order (e.g., always render
   first) beyond styling?
3. `forgot-password` — confirmed as UI-fidelity-only in this proposal (no
   real reset flow). Is that the right call for now, or should a follow-up
   change be filed immediately for the actual backend flow?

Assumptions used until corrected: (1) plain click-confirm for groups,
typed-reason stays payments-only; (2) styling-only escalation, no reorder;
(3) fidelity-only fix, backend flow deferred as a separate future change.
