# Design: Vibrant Palette Activation (Track B)

## Technical Approach

Token-value swap inside the existing `cata-*` Tailwind namespace — no new
tokens beyond the two already scoped (`red-light`, `red-dark`), no component
extraction, no routing/shell/process changes. `tailwind.config.ts` is the
single source of truth: updating `colors.cata.red` (and defining
`red-light`/`red-dark`) propagates automatically to ~19 files that already
consume `bg-cata-red` / `text-cata-red` / `hover:*-cata-red-light` via
Tailwind's utility-class generation — zero edits needed in those files. Only
four surfaces need direct edits: `globals.css` (4 hardcoded hex literal
patterns, 5 occurrences, since `.btn-primary`/`.input-field` bypass the
token and hardcode hex directly), `Header.tsx` (2 narrow spots × 2 instances
each — Demo badge, menu-toggle hover), and 9 `page.tsx` files (1 literal
gradient → `.bg-logo-glow` class swap each). Delivery is 3 small,
independent PRs targeting `main` directly (see Branching section) —
deliberately not a stacked/chained branch structure.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| `cata-red-light` derivation | Mirrored-HSL: base H357.7°/S73.6°, dark L37.3% (`#A11D22`, user-fixed), delta −11.8pp mirrored up from base L49.0% → L60.8% = `#E55157` | (a) Eyeball a lighter hex by feel; (b) reuse existing `#B22222` as-is (today's `red-light` value) | Proposal §"Red ramp derivation" already reviewed and confirmed by the user (2026-07-15); mirrored-HSL keeps the ramp visually symmetric around the base instead of an arbitrary pick, and is cheap to adjust later (single config value) if design sign-off disagrees. `#B22222` was rejected because it's the *current* muted-palette artifact being replaced, not derived from the new vibrant base |
| `.bg-logo-glow` reuse for 9-file gradient sweep | Wire up the existing dead `.bg-logo-glow` utility (`globals.css:145-147`, already `rgba(217,33,40,...)` — vibrant-red-correct) | Write a fresh utility class or keep the inline arbitrary-value literal duplicated 9×, only updating its rgba() | `.bg-logo-glow` is a prior abandoned attempt that already has the *correct* vibrant value sitting unused; reusing it collapses 9× duplicated inline literals into 1 shared declaration — no new CSS surface, pure DRY win, confirmed byte-identical visual intent (ellipse gradient, same position/opacity/falloff) |
| Config-only propagation vs. per-file token replacement | Change `tailwind.config.ts` once; let ~19 existing consumers inherit | Grep-and-replace hex/token usage in each of the 19 files | Those files already reference the `cata-red` *token*, not hardcoded hex — Tailwind resolves utility classes from config at build time, so no per-file edit is possible or needed. Confirmed via proposal's Affected Areas table and re-verified live against `tailwind.config.ts` (current `red: "#8B1A1A"`, `red-light: "#B22222"`, `red-dark: "#5E1111"` — none of the 19 consumer files hardcode these hexes) |
| Header.tsx edit scope | Touch only Demo badge classes (2 instances, lines ~220 and ~248) and mobile-menu-toggle hover classes (2 instances, lines ~154 in `InstitutionalHeader` and ~299 in main `Header`) | Also address the pre-existing worsened dark-chrome logout-hover contrast noted in the proposal's risk table | Out of scope per proposal — that contrast issue is pre-existing on the same `hover:text-cata-red` token and not introduced by this change; touching it would expand the diff beyond the two named spots and duplicate Track C's mandate |

## Data Flow

    tailwind.config.ts (colors.cata.red/-light/-dark)
              │
              ├─→ ~19 existing consumers (bg-cata-red, text-cata-red,
              │    hover:bg-cata-red-light, etc.) — automatic, no edit
              │
              ├─→ globals.css (.btn-primary, .btn-primary:hover,
              │    .input-field:focus) — direct hex edit, 4 patterns/5 occ.
              │
              └─→ (independent) Header.tsx Demo badge → cata-yellow/black
                  Header.tsx menu-toggle hover → cata-fuchsia
                  9× page.tsx inline gradient → .bg-logo-glow (globals.css)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `tailwind.config.ts` | Modify | `colors.cata.red`: `#8B1A1A`→`#D92128`; `red-light`: `#B22222`→`#E55157`; `red-dark`: `#5E1111`→`#A11D22` |
| `src/app/globals.css` | Modify | `.btn-primary` bg (`#8B1A1A`→`#D92128`); `.btn-primary:hover` bg+shadow (`#B22222`/`rgba(139,26,26,0.3)`→new values); `.input-field:focus` border+shadow (`#8B1A1A`/`rgba(139,26,26,0.2)`→new values) — 4 literal patterns, 5 occurrences total |
| `src/components/Header.tsx` | Modify (narrow) | Line ~220 (skeleton) + ~248 (live): Demo badge `bg-amber-500/20 text-amber-400` → `bg-cata-yellow text-cata-black`. Line ~154 (`InstitutionalHeader`) + ~299 (main `Header`): menu-toggle button `hover:text-white` → `hover:text-cata-fuchsia` |
| `src/app/dashboard/page.tsx` | Modify (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| `src/app/trainer/page.tsx` | Modify (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| `src/app/trainer/attendance/page.tsx` | Modify (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| `src/app/attendance/page.tsx` | Modify (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| `src/app/student/page.tsx` | Modify (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| `src/app/student/enroll/page.tsx` | Modify (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| `src/app/payments/page.tsx` | Modify (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| `src/app/groups/page.tsx` | Modify (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| `src/app/members/page.tsx` | Modify (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| ~19 files using `bg-cata-red`/`text-cata-red`/`hover:*-cata-red-light` (incl. `globals.css` `.btn-secondary`, `attendance/page.tsx`, `register/page.tsx`, `student/enroll/page.tsx`, `login/page.tsx`) | No edit | Inherit new hex values automatically via Tailwind config resolution |
| `cata-amber`, capacity-bar colors (`groups-page-utils.ts`), Header dark-chrome background/nav-link semantics | Untouched | Explicit non-goals per proposal |

Verified live: `Header.test.tsx` has zero `toHaveClass`/`className`
assertions — only `getByText("Demo")` presence checks and
`aria-expanded`/`aria-label` checks on the menu-toggle button. No test
changes required for PR2.

## Interfaces / Contracts

No new types, props, or API contracts. Pure CSS-token-value and
className-string changes.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Build | Type/compile safety across all 3 PRs | `pnpm build` (`tsc --noEmit` included) — class-value-only edits still risk stray syntax errors |
| Unit (PR2 only) | `Header.test.tsx` | Re-run `pnpm test` — confirmed no `toHaveClass`/class-string assertions exist today, so this is expected to stay GREEN with zero test edits. If a future review finds a class-string assertion, that would be a genuine RED→GREEN test change; none found in this design pass |
| Visual (manual, all 3 PRs) | No automated visual regression exists | Manual smoke per config's strict-TDD visual-only carve-out: buttons/inputs render vibrant red (PR1); Demo badge renders solid yellow/black in both skeleton and live header states, menu-toggle hover shows fuchsia on dark chrome (PR2); all 9 pages render `.bg-logo-glow`'s ellipse gradient indistinguishably from the old inline gradient except for hue — same position/opacity/falloff, only rgb values differ (PR3) |
| Manual contrast spot-check (PR1, tracked not blocking) | Opacity-tinted `bg-cata-red/10`, `/15`, `/30` usages (badges/chips, e.g. active nav-link `bg-cata-red/15` in Header) | Visual inspection against light and dark backing surfaces per proposal's Success Criteria; document pass/needs-follow-up, does not block merge |
| Strict TDD carve-out | `apply.tdd: true` per `openspec/config.yaml` | All 3 PRs are class-value/token swaps with no testable JS behavior change — verified via build + manual smoke, consistent with the carve-out already used by `design-system-migration` |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary in this change. Confirmed:
scope is limited to Tailwind config values, one CSS file, one component's
className strings, and 9 pages' className strings.

## Branching / PR Sequence

Flat, direct-to-`main` — **no tracker branch, no stacking.** This is a
deliberate correction from `design-system-migration`'s
`feature-branch-chain` pattern: that 11-level-deep stack broke in
production because GitHub's squash-merge strategy destroys git ancestry
between stacked levels, silently failing several PRs in the chain and
auto-closing them without merging (required manual recovery). None of these
3 PRs need each other's branch as a base — they touch disjoint files and
each is independently reviewable and mergeable.

```
main ──┬── PR1: tailwind.config.ts + globals.css     (targets main)
       ├── PR2: Header.tsx (yellow badge + fuchsia)   (targets main)
       └── PR3: 9× page.tsx .bg-logo-glow sweep       (targets main)
```

- **PR1** — no dependency on PR2 or PR3. Ships first per user-confirmed
  ordering (red ramp is the highest-traffic surface).
- **PR2** — zero file overlap with PR1 or PR3, zero token dependency
  (yellow/fuchsia hexes unchanged). Can land before, after, or in parallel
  with PR1/PR3.
- **PR3** — soft (visual-consistency, not functional) dependency on PR1
  landing first, since `.bg-logo-glow`'s hardcoded `rgba(217,33,40,...)`
  should read as the same red family as the new `cata-red`. Must be
  explicitly sequenced/communicated with the parallel
  `admin-usability-heuristics` (Track C) change, since PR3's 9 files are
  the exact same files Track C's usability fixes touch — this is a
  cross-change file-collision risk, not a cross-PR git-ancestry risk.

Each PR is reviewed and merged independently; none requires rebasing onto a
sibling PR's branch.

## Migration / Rollout

No migration required. Each PR is `git revert`-able independently
(disjoint files: PR1 = config + globals.css, PR2 = Header.tsx, PR3 = 9
page.tsx files). Reverting PR1 alone restores the muted red across every
token consumer at once, since consumption is entirely via the Tailwind
token, not hardcoded per-component. PR3's dependency on PR1 is visual-only,
not functional — reverting PR3 does not require reverting PR1, and vice
versa.

## Open Questions

None blocking. The one flagged unknown in the task brief —whether
`Header.test.tsx` needs updates for the Demo badge color-class change— is
resolved: the test file has zero class-string assertions (only text-content
and aria-attribute checks), so PR2 needs no test edits.
