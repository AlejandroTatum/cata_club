# Exploration: Vibrant Palette Activation (Track B)

> Direct continuation of `design-system-migration` (Track A, merged). That
> proposal explicitly deferred "activating the vibrant brand palette" as a
> separate future change — this is that change.

## Two independent styling systems exist today

1. **Admin panel** (`src/app/**/page.tsx`, `src/app/globals.css`) — Tailwind
   `cata-*` namespace declared once in `tailwind.config.ts`.
2. **Public landing page** (`src/app/landing/landing.css`) — its own CSS
   custom-property system, scoped under `.landing-page`, entirely independent
   of Tailwind's `cata-*` tokens. Already vibrant.

`tailwind.config.ts` today:
```
red: "#8B1A1A"        ← still muted, current admin primary
"red-light": "#B22222"
"red-dark": "#5E1111"
yellow: "#FFD600"     ← already vibrant value, but UNUSED anywhere in src/
amber: "#F4B41A"      ← already present, UNUSED anywhere in src/
fuchsia: "#E5397D"    ← already vibrant value, but UNUSED anywhere in src/
```

`landing.css` primitives: `--landing-brand-red: #d92128`,
`--landing-brand-red-strong: #a11d22` (hover/dark variant — no lighter tint
exists), `--landing-brand-yellow: #ffd600`, `--landing-brand-fuchsia:
#e5397d`.

**On commit `3c3ef24` ("apply v4 vibrant red across admin panel accents")**:
message is misleading. Grep for `D92128`/`FFD600`/`E5397D` across `src/`
returns hits only in `landing.css`. The admin panel's `cata-red` is still
`#8B1A1A` today, confirmed live. The commit activated the vibrant palette for
the landing page only, not the admin panel.

## Affected areas (NOT config-only — key correction to initial assumption)

| File(s) | What's there | Needs touching? |
|---|---|---|
| `tailwind.config.ts` | `cata-red`/`red-light`/`red-dark` muted values | Yes — core change |
| `src/app/globals.css` | 4 hardcoded literals: `.btn-primary` bg + hover shadow, `.input-field` focus border + shadow (all `#8B1A1A`/`rgba(139,26,26,...)`). Also 2 **unused dead utilities** (`.bg-subtle-dot`, `.bg-logo-glow`) that already use the vibrant `rgba(217,33,40,...)` — an abandoned prior attempt, never wired to any component. | Yes — 4 literals to update; reuse the dead utilities instead of re-inventing |
| **9× `page.tsx` files** — `dashboard`, `trainer`, `trainer/attendance`, `attendance`, `student`, `student/enroll`, `payments`, `groups`, `members` | Each has an identical duplicated inline arbitrary-value class: `bg-[radial-gradient(circle_at_80%_20%,rgba(139,26,26,0.05),transparent_50%)]` | **Yes — this breaks the "config-only, zero overlap" assumption.** Real file overlap with Track C. |
| ~19 files using `bg-cata-red`/`text-cata-red`/etc. as pure semantic classNames | Correct usage | No edit — inherits new value automatically |
| `src/components/Header.tsx` | Still `bg-cata-dark` (dark chrome, deliberately out of Track A scope) | Not in scope, but a contrast risk surface (see below) |

## Open design decisions (not resolved by this exploration)

1. **`cata-red-light`/`cata-red-dark` have no vibrant precedent.** Landing
   only provides a darker hover value (`#A11D22`); no lighter tint exists
   anywhere in the codebase. Needs an explicit decision in the proposal.
2. **Yellow/fuchsia have zero current consumers** in the admin panel (tokens
   exist, unused). This track is red-only in terms of real activation unless
   scope is deliberately expanded — flagged as a scope-boundary question, not
   assumed either way.

## Contrast/accessibility (WCAG 2.1, computed)

| Pair | Ratio | AA normal (4.5:1) | AA large/UI (3:1) |
|---|---|---|---|
| `#8B1A1A` (current) on `#FFFFFF`/`#F9FAFB` | ≈9.3:1 | Pass (AAA too) | Pass |
| `#D92128` (target) on `#FFFFFF`/`#F9FAFB` | ≈5.0:1 | Pass, thin ~11% margin | Pass comfortably |
| `#D92128` on `Header.tsx`'s dark chrome | ≈3.8:1 (est.) | Fails for normal text | Marginal, large/bold only |

Passes AA on the light admin surfaces this track targets, but with a much
thinner margin than the current muted red (9.3:1 → 5.0:1). Opacity-tinted
usages (`bg-cata-red/10`, `/15`, `/30` badge/chip tints already in use) need a
manual post-implementation contrast re-check since opacity compounds against
near-white backgrounds. `Header.tsx`'s dark-chrome hover contrast is a
pre-existing-but-slightly-worsened condition (same token, different consuming
surface), not newly introduced — that component stays out of scope.

## File-overlap risk with the parallel Track C (usability/hierarchy)

**Not zero-overlap, as originally assumed.** `tailwind.config.ts` (1 file)
and `globals.css` (1 file, 4 literal edits) are low-collision. But the 9
`page.tsx` files carrying the duplicated inline gradient literal are real,
direct overlap with whatever Track C touches in those same page bodies.
Mitigated by sequencing (see Approach below), not eliminated.

## Approaches considered

1. **Config-only + literal sweep, sequenced in two PRs (recommended).**
   PR 1: `tailwind.config.ts` + `globals.css` only — isolated, reviewable,
   zero component-file touch. PR 2: replace the 9 duplicated inline literals
   with the existing (currently dead) `.bg-logo-glow` utility class instead
   of hand-editing 9 near-identical hex strings — single source of truth
   going forward. PR 2 explicitly sequenced/communicated with Track C's owner
   since it's the one real overlap point.
   - Pros: smallest diff per file, reuses dead code, isolates the only real
     conflict surface into one small, clearly-labeled PR.
   - Cons: still two PRs instead of one; needs the `red-light`/`red-dark`
     decision resolved first.
2. **Config + globals.css only, leave the 9 inline literals muted.**
   - Pros: genuinely zero file overlap with Track C.
   - Cons: ships a visibly inconsistent result — decorative glows stay old
     muted red while buttons/links/badges go vibrant. Reintroduces the same
     "off-brand-looking inconsistency" flavor that Track A's B1 fixed.
3. **Full activation including yellow/fuchsia consumption.**
   - Rejected for this change — no existing use case, would expand scope
     beyond "activate what Track A deferred" into new UI decisions that
     belong with Track C's hierarchy work, if anywhere.

## Recommendation

Approach 1. Resolve `red-light`/`red-dark` vibrant equivalents explicitly in
the proposal before tasks are written. Flag the 9-file sequencing point to
whoever runs Track C so it isn't a silent merge conflict.

## Risks

- Thin AA margin (~5.0:1) on solid `#D92128`/white; opacity-tint usages need
  a manual spot-check post-implementation.
- `red-light`/`red-dark` have no landing precedent — undecided design input.
- Genuine (not zero) file overlap with Track C across 9 `page.tsx` files —
  needs explicit sequencing, not a silent parallel run.
- `Header.tsx` dark-chrome contrast slightly worsens (pre-existing condition,
  component itself out of scope).
- Commit `3c3ef24`'s exact diff not directly verified via `git show` in this
  exploration (tool constraint) — conclusion drawn from strong, consistent
  live-file grep evidence instead.
