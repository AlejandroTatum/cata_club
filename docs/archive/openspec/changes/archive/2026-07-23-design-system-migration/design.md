# Design: Design System v1 — Admin Panel Light-Theme Migration (Track A)

## Technical Approach

Literal, phased token swap (0→6) inside the existing `cata-*` Tailwind
namespace — no new namespace, no React component extraction, no `#8B1A1A`
change. Fase 0 adds 5 light tokens to `tailwind.config.ts` and rewrites the 8
shared `globals.css` classes in place (same class names, new values) plus one
new class `.alert-error`. Fases 1–5 then migrate each view's raw utility
classes (`bg-cata-navy`, `bg-cata-dark-elevated`, `bg-cata-dark-surface`,
`bg-cata-dark`) to the new tokens, reusing one hero-band+card pattern
established in Fase 2. Fase 6 is a QA pass, no code changes beyond fixes found.
Delivery is `feature-branch-chain`: tracker `design-system-migration`, one
child PR per phase, oversized views split into sub-PRs to respect the
400-line budget.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Token key collision (`border`, `text-primary`) | Overwrite `cata.border` in place; leave `text-primary`/`text-secondary`/`border-hover` untouched | Add `cata.border-light` as a separate key | Grepped `src/`: `cata-border`, `cata-text-primary`, `cata-text-secondary`, `cata-border-hover` have **zero** usages anywhere. Safe to overwrite `border`; no need to invent a second key not in the task doc's literal 5-token list |
| Shared class rewrite mechanism | Edit `.card`/`.btn-*`/`.input-field`/`.badge-*` hex values in place in `globals.css`, keep class names | Introduce Tailwind `@apply` full rewrite | Classes already mix hardcoded hex + `@apply`; least-diff path is value swap only, preserves the `@apply` utility chains untouched |
| Card shadow | Switch `.card`/`.card-hover` to existing `shadow-card`/`shadow-elevated` tokens (already defined in `tailwind.config.ts` `boxShadow`, currently unused) | Invent new light-mode shadow values | Avoids adding config surface; these tokens were dead code, now activated |
| `.alert-error` extraction | New shared class = `.badge-error`'s visual pattern (bg/border/text) + block layout (`rounded-lg border px-3 py-2 text-xs`), both login (`role="alert"` + icon) and register (bare `<p>`) converge on the login markup shape | Keep register's simpler `<p>`-only markup as the shared form | Login's version has `role="alert"` (a11y) + icon; register loses nothing by adopting it, login loses nothing — pick the more accessible superset |
| Hero-band pattern reuse | One canonical light hero recipe (`bg-cata-surface` + `border-cata-border` + shadow, replacing `bg-cata-navy`) authored once in Fase 2 (dashboard/members/groups), copied verbatim in Fase 3–5 | Re-derive per view | 11/13 views share the identical `rounded-3xl ... bg-cata-navy px-6 py-10` hero block (confirmed via grep) — one pattern, many call sites |
| Oversized view PRs | Split by section (hero+summary cards vs. table+badges), not by line-count arithmetic alone | One PR per view regardless of size | Section boundaries are reviewable diffs; arbitrary line-count splits produce unreviewable partial-render states |

## File Changes

| File | Action | Phase |
|---|---|---|
| `tailwind.config.ts` | Modify — add `bg`, `surface`, `text`, `border` (overwrite), `state-ok` under `colors.cata` | 0 |
| `src/app/globals.css` | Modify — `.card`, `.card-hover`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.input-field`, `.badge-success/-warning/-error/-neutral` values; add `.alert-error` | 0 |
| `src/app/layout.tsx` | Modify — `body` class `bg-cata-dark` → `bg-cata-bg`, `text-white` → `text-cata-text` | 0 |
| `src/app/login/page.tsx` (301) | Modify — light surface, B1 role-chip colors → brand tokens, B2 → `.alert-error` | 1 |
| `src/app/register/page.tsx` (490) | Modify — light surface, B2 → `.alert-error` | 1 |
| `src/app/forgot-password/page.tsx` (10, stub) | Modify — light surface | 1 |
| `src/app/dashboard/page.tsx` (242) | Modify — hero pattern origin, light surface | 2 |
| `src/app/members/page.tsx` (468) | Modify — hero + table, light surface | 2 |
| `src/app/groups/page.tsx` (625) + `groups-page-utils.ts` | Modify — hero + table, B3 level badges → brand tokens | 2 |
| `src/app/payments/page.tsx` (754) | Modify, split A/B | 3 |
| `src/app/attendance/page.tsx` (369) | Modify — B4 status badges → `state-ok` | 3 |
| `src/app/trainer/page.tsx` (393) | Modify | 4 |
| `src/app/trainer/attendance/page.tsx` (624) | Modify, split if >400 diff | 4 |
| `src/app/student/page.tsx` (964) | Modify, split A/B/C | 5 |
| `src/app/student/enroll/page.tsx` (1034) | Modify, split A/B/C | 5 |
| `src/app/products/*` (11) | None | — |

## Per-Phase Approach and 400-Line Split

- **Fase 0**: single PR, 2 files (`tailwind.config.ts` + `globals.css`) + `layout.tsx`. Est. diff well under budget; highest blast radius (11/13 views render via these classes) — mitigated by manual smoke pass before Fase 1 starts.
- **Fase 1** (login/register/forgot-password): 3 files, ~800 combined lines but only the surface/color lines actually change (est. diff <300). One PR.
- **Fase 2** (dashboard/members/groups + B3): establishes the hero+card pattern. Members (468) and groups (625) are candidates for their own PRs if the diff (not file size) exceeds 400; dashboard (242) can ride with whichever is smallest.
- **Fase 3** (payments 754, attendance 369): payments' 754 lines make a single-file full-surface diff likely >400 — split **PR A** (hero band + summary/stat cards, top ~350 lines) and **PR B** (payments table + status badges + B4 fix, remaining ~400 lines), both targeting the previous phase branch in sequence. Attendance (369, B4 fix) rides with PR B or its own small PR.
- **Fase 4** (trainer 393, trainer/attendance 624): trainer alone likely fits in one PR; trainer/attendance (624) gets the same hero/table split as payments if its diff exceeds 400.
- **Fase 5** (student 964, student/enroll 1034): each requires a 3-way split — **PR A** hero + profile/summary cards, **PR B** tables/lists + badges, **PR C** multi-step enroll form panels (enroll only) — mirroring the proven Fase 3 split pattern.
- **Fase 6**: QA-only PR(s) fixing contrast/mobile issues found; no new pattern.

## Branching / PR Sequence (feature-branch-chain)

```
main
 └─ design-system-migration (tracker)
     └─ fase-0-tokens                     → PR #1  target: tracker
         └─ fase-1-auth                   → PR #2  target: fase-0-tokens
             └─ fase-2-dashboard-members-groups → PR #3  target: fase-1-auth
                 └─ fase-3a-payments-hero  → PR #4  target: fase-2-...
                     └─ fase-3b-payments-table-attendance → PR #5  target: fase-3a-...
                         └─ fase-4-trainer → PR #6  target: fase-3b-...
                             └─ fase-4b-trainer-attendance (if split) → PR #7
                                 └─ fase-5a-student-hero  → PR #8
                                     └─ fase-5b-student-table → PR #9
                                         └─ fase-5c-student-enroll-form → PR #10
                                             └─ fase-6-qa      → PR #11 target: fase-5c-...
                                                 (tracker merges to main once #11 lands)
```
Every child PR retargets/rebases if GitHub shows prior slices in its diff.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `groups-page-utils.ts`, `RegisterPage.test.tsx` (existing suites touch files this change modifies) | Update assertions only if they assert on class strings; run `pnpm test` (Vitest) per PR |
| Build | Type/compile safety | `tsc --noEmit` via `pnpm build` per PR — CSS/class-only edits still risk TS errors in split JSX |
| Visual (manual) | Contrast, status-by-text, mobile/tablet/desktop | No automated visual regression exists; manual smoke checklist per PR (documented, not scripted), full pass in Fase 6 |
| Strict TDD | `apply.tdd: true` per config | Class-value swaps have no testable behavior — verified via build + manual smoke per config's explicit carve-out, not a RED test |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary in this change.

## Migration / Rollout — Rollback Plan

Each phase PR is `git revert`-able independently once merged, since Fases 1–5 touch disjoint view sets. **Fase 0 is the highest-risk revert**: every later branch is rebased on top of it, so reverting it after child branches exist cascades — requires reverting/rebuilding the whole downstream chain, not a single clean revert. Mitigation: do not start Fase 1 until Fase 0's manual smoke pass is signed off. `main` is untouched until the tracker's final merge.

## Risk — Merge Friction with `e739503`/`bf20d44`

Both commits added the exact `bg-cata-navy` hero block (`rounded-3xl ... px-6 py-10`) now present at `dashboard/page.tsx:95`, `members/page.tsx:320`, `groups/page.tsx:157`, plus matching `bg-cata-dark-elevated` footer cards at line ~184/446/602 in each file. Fase 2 rewrites these exact className strings from dark to light — not a conflict with *unrelated* code, but a direct re-theme of lines those two commits just introduced. Since this work continues on the same branch (`feat/refactor-and-responsive` → tracker), there is no cross-branch merge conflict, but there is real rework risk: any further dark-hero-pattern commits landing on `main` before the tracker merges would need re-theming again. Mitigation: rebase the tracker onto `main` once before Fase 2 starts, then avoid further unrelated hero-pattern commits on `main` until the tracker merges.

## Open Questions

- [ ] Exact sub-PR line boundaries for `student`/`student/enroll` (3-way split) should be confirmed against real diff output once Fase 4 lands — estimates above are structural, not diff-measured.
