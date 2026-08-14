# Tasks: Vibrant Palette Activation (Track B)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~20-30 (PR1) + ~10-15 (PR2) + ~10-20 (PR3) ≈ 45-65 total |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | 3 independent PRs, flat (PR1, PR2, PR3 each → `main`) |
| Delivery strategy | single-pr (per slice — 3 disjoint-file slices, not chained to each other) |
| Chain strategy | stacked-to-main (each PR branches from and merges to `main` independently, in order; not git-branch-stacked — see design.md's flat structure) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

Already-decided per design.md: 3 small, disjoint-file PRs, each branching from and targeting `main` directly. No tracker branch, no stacking between PRs (fixing the 11-level stacked-PR squash-merge incident from `design-system-migration`). PR1 ships first (highest-traffic surface); PR2 has zero dependency on PR1/PR3; PR3 has a soft visual-consistency dependency on PR1 landing first.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `tailwind.config.ts` + `globals.css` red-ramp token swap | PR1 | `pnpm build` | `pnpm dev`; visual check `.btn-primary` rest/hover + `.input-field` focus ring on login/dashboard | `git revert` PR1; disjoint from PR2/PR3 files |
| 2 | `Header.tsx` Demo badge (yellow) + menu-toggle hover (fuchsia) | PR2 | `pnpm test` (`Header.test.tsx`, no edits expected) + `pnpm build` | `pnpm dev`; check Demo badge in skeleton + live header, hover mobile menu-toggle | `git revert` PR2; disjoint from PR1/PR3 files |
| 3 | 9× `page.tsx` inline gradient → `.bg-logo-glow` | PR3 | `pnpm build` | `pnpm dev`; visually compare radial glow on all 9 pages before/after | `git revert` PR3; disjoint from PR1/PR2 files |

## Phase 1: Red Ramp Token Swap — PR1 (`tailwind.config.ts` + `globals.css`, target: `main`)

- [x] 1.1 `tailwind.config.ts`: `colors.cata.red` `#8B1A1A`→`#D92128`, `red-light` `#B22222`→`#E55157`, `red-dark` `#5E1111`→`#A11D22`
- [x] 1.2 `globals.css`: `.btn-primary` background `#8B1A1A`→`#D92128`
- [x] 1.3 `globals.css`: `.btn-primary:hover` background→`#E55157` + box-shadow `rgba(139,26,26,0.3)`→`rgba(217,33,40,0.3)`
- [x] 1.4 `globals.css`: `.input-field:focus` border-color + box-shadow `rgba(139,26,26,0.2)`→`rgba(217,33,40,0.2)`/matching vibrant hex
- [x] 1.5 Grep `globals.css` for `#8B1A1A`/`rgba(139,26,26,...)` — confirm zero occurrences remain (confirmed: zero matches)
- [x] 1.6 `pnpm build` passes (TDD carve-out: pure CSS/token-value swap, no testable JS behavior) — `next build` compiled successfully, all 18 routes generated
- [ ] 1.7 Manual visual smoke: `pnpm dev`, verify `.btn-primary` rest/hover and `.input-field` focus ring render vibrant red on login + dashboard — NOT executed by apply agent (no browser available in this environment); requires human verification before merge
- [ ] 1.8 Manual contrast spot-check (tracked, non-blocking): inspect opacity-tinted `bg-cata-red/10`, `/15`, `/30` usages (badges/chips, active nav-link `bg-cata-red/15` in `Header.tsx`) against light and dark backing surfaces; document pass/needs-follow-up — NOT executed by apply agent; requires human verification (non-blocking per proposal)

## Phase 2: Header Yellow Badge + Fuchsia Hover — PR2 (`src/components/Header.tsx`, target: `main`)

- [x] 2.1 Line ~220 (skeleton header): Demo badge `bg-amber-500/20 text-amber-400`→`bg-cata-yellow text-cata-black`
- [x] 2.2 Line ~248 (live header): Demo badge `bg-amber-500/20 text-amber-400`→`bg-cata-yellow text-cata-black`
- [x] 2.3 Line ~154 (`InstitutionalHeader` menu-toggle): `hover:text-white`→`hover:text-cata-fuchsia`
- [x] 2.4 Line ~299 (main `Header` menu-toggle): `hover:text-white`→`hover:text-cata-fuchsia`
- [x] 2.5 `pnpm test` — confirm `Header.test.tsx` stays GREEN with zero edits (no `toHaveClass`/className assertions) — 15/15 Header tests passed, 454/454 full suite passed, zero test file edits
- [x] 2.6 `pnpm build` passes — `next build` compiled successfully, all 18 routes generated
- [ ] 2.7 Manual visual smoke: `pnpm dev`; confirm Demo badge is solid yellow/black in skeleton and live states; hover menu-toggle shows fuchsia on dark chrome; confirm no `cata-fuchsia` on any light-surfaced page body — NOT executed by apply agent (no browser available); requires human verification before merge

## Phase 3: `.bg-logo-glow` Sweep — PR3 (9× `page.tsx`, target: `main`, after PR1 lands)

Coordinate timing with the parallel `admin-usability-heuristics` (Track C) change before starting — it touches these same 9 files.

- [x] 3.1 `dashboard/page.tsx`: inline `bg-[radial-gradient(...rgba(139,26,26,0.05)...)]`→`.bg-logo-glow`
- [x] 3.2 `trainer/page.tsx`: same swap
- [x] 3.3 `trainer/attendance/page.tsx`: same swap
- [x] 3.4 `attendance/page.tsx`: same swap
- [x] 3.5 `student/page.tsx`: same swap
- [x] 3.6 `student/enroll/page.tsx`: same swap
- [x] 3.7 `payments/page.tsx`: same swap
- [x] 3.8 `groups/page.tsx`: same swap
- [x] 3.9 `members/page.tsx`: same swap
- [x] 3.10 Grep all 9 files for inline `bg-[radial-gradient(...rgba(139,26,26,...)...)]` — confirm zero occurrences remain (confirmed: zero matches; all 9 files use `bg-logo-glow`)
- [x] 3.11 `pnpm build` passes — `next build` compiled successfully, all 18 routes generated
- [ ] 3.12 Manual visual smoke: `pnpm dev`; compare radial glow position/size/color-intent on all 9 pages before/after (expect same vibrant-red family as PR1, per `.bg-logo-glow`'s existing `rgba(217,33,40,...)`) — NOT executed by apply agent (no browser available); requires human verification before merge

### Apply Notes (deviation from plan)

PR3's local pre-commit AI review hook (Gentleman Guardian Angel) proved
non-deterministic across ~5 attempts on the full 9-file batch: two runs
timed out (300s provider timeout), and two runs produced contradicting
findings on the same unchanged `payments/page.tsx` `catch (err)` bindings
(first flagged as unused, self-corrected as "used in `console.error`" in
its own next run's "Key Learnings," then flagged unused again, then
confirmed used again). Splitting the same 9-file diff into two smaller
commits (5 files + 4 files) on the same `track-b-pr3-glow-sweep` branch
let the hook pass reliably both times — no content changed between the
single-commit attempts and the split-commit attempts, confirming this was
a hook batch-size/reliability issue, not a real code violation.

One genuine (pre-existing, unrelated-line) issue surfaced during this
process and was fixed as a minimal, disclosed, zero-behavior-change
deviation beyond the assigned tasks: `buildFichaMedica` (unused import,
`student/enroll/page.tsx:40`) and `ArrowRight` (unused import,
`trainer/attendance/page.tsx:39`) were both dead code unrelated to the
gradient-literal swap, deleted only because the repo's mandatory
pre-commit gate required it before the touched files could be committed.
`pnpm build` re-verified green after both deletions.
