# Proposal: Design System v1 — Admin Panel Light-Theme Migration (Track A)

## Intent

The admin panel (13 views) is hardcoded dark (`cata-dark #0A0A12`, `cata-navy`
surfaces) against the approved "Sistema de Diseño v1" (`01-cata-club-design-
system.pdf`), which specifies a light admin surface. Four known UI bugs (off-
brand colors, duplicated markup, non-token badges) compound the drift. This
change brings the panel's surface, borders, text, and status badges onto the
new light tokens now, without waiting for the larger vibrant brand-hue
question to be resolved.

## Scope

### In Scope
- Phases 0–6 of `03-tareas-implementacion.md`, literally: add `bg #F9FAFB`,
  `surface #FFFFFF`, `text #1F2937`, `border #E5E7EB`, `state-ok #15803D` to
  the existing `cata-*` Tailwind namespace (no `brand-*` rename).
- `layout.tsx` body, `globals.css` (`.card`, `.btn-*`, `.input-field`,
  `.badge-*`) → light surface.
- Migrate all 13 views (+ verify `products` stub needs no work).
- Fix B1 (off-brand demo-role chip colors), B2 (duplicated error banner →
  shared `.alert-error`), B3 (group-level badges → brand tokens), B4 (status
  badges → `state-ok`).
- Cross-cutting QA: contrast (yellow=black text n/a here, red=white text,
  status distinguishable by text, not color alone), mobile/tablet/desktop
  pass.

### Out of Scope (explicit non-goals)
- **Track B (future, separate SDD change)**: activating the vibrant brand
  palette (`#D92128` red, `#FFD600` yellow, `#E5397D` fuchsia). The primary
  button red (`#8B1A1A`) is kept as-is in this change.
- **Button/Card/Badge/Input React component extraction** — listed as
  "Opcional / no bloqueante" in the task doc; no such components exist today.
- **B5 (fuchsia nav hover contrast)** — dropped, unreproducible: no
  `landing.css` exists, zero fuchsia usage in `src/`.
- Capacity-bar colors in `groups-page-utils.ts` (theme-agnostic, untouched).

## Capabilities

### New Capabilities
- `admin-light-theme`: light-mode design tokens (bg/surface/text/border/
  state-ok), shared error-banner/badge patterns, and the accessibility
  contract (status distinguishable by text + color, not color alone; WCAG AA
  contrast for red-on-white).

### Modified Capabilities
- None — `openspec/specs/` is currently empty.

## Approach

Execute the task doc's phase sequence (0 → 6) as a tracker branch
(`design-system-migration`) with child PRs per phase, each targeting the
previous phase's branch (feature-branch-chain). Large views (`payments` 754
lines, `student` 964, `student/enroll` 1034) will each need their own PR, and
possibly a further split, to stay under the 400-changed-line budget.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `tailwind.config.ts` | Modified | Add light tokens under `cata-*` |
| `src/app/globals.css`, `layout.tsx` | Modified | Shared classes → light surface |
| `login`, `register`, `forgot-password` | Modified | Fase 1 + B1/B2 |
| `dashboard`, `members`, `groups` | Modified | Fase 2 + B3 |
| `payments`, `attendance` | Modified | Fase 3 (largest single PR risk) |
| `trainer`, `trainer/attendance` | Modified | Fase 4 |
| `student`, `student/enroll` | Modified | Fase 5 (largest views) |
| `products` | None | Stub, redirect only |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Merge friction with recent dark-hero commits (`e739503`, `bf20d44`) | Med | Rebase tracker branch first; re-theme those surfaces in Fase 2 explicitly |
| `payments`/`student`/`student/enroll` exceed 400-line PR budget | High | Split each into sub-PRs within its phase (e.g., table vs. form sections) |
| Missing `design/admin-design-system-audit.md` | Low | Derive per-view detail from live file reads (already done in exploration) |
| Fase 0 shared-class regression has sitewide blast radius (11/13 views) | Med | Visual smoke pass after Fase 0 before Fase 1 starts |

## Rollback Plan

Each phase PR is independently revertible (`git revert`) since phases touch
disjoint view sets after Fase 0. Fase 0 (shared classes) is the highest-risk
revert point — if it breaks builds sitewide, revert that single PR before any
child branch rebases onto it. The tracker branch only merges to `main` once
all phases pass; `main` is never touched mid-migration.

## Dependencies

- None external. Sequential: Fase 0 blocks all others; Fase 2/3 patterns
  should land before Fase 4/5 reuse them.

## Success Criteria

- [ ] Fase 0: any unmigrated view renders in light mode via shared classes.
- [ ] Fase 1: 3 auth screens light, no off-brand colors (B1/B2 fixed).
- [ ] Fase 2: dashboard/members/groups share one light hero+card pattern (B3 fixed).
- [ ] Fase 3: payments/attendance use `state-ok` badges, status readable by text (B4 fixed).
- [ ] Fase 4/5: trainer + student views reuse the validated pattern.
- [ ] Fase 6: all 13 views pass contrast + mobile/tablet/desktop QA.
- [ ] `pnpm test` and `pnpm build` pass after each phase PR.
