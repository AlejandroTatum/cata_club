# Proposal: Vibrant Palette Activation (Track B)

## Intent

`design-system-migration` (Track A, merged) brought the admin panel onto a
light surface but deliberately kept the primary red muted (`#8B1A1A`) and
left `cata-yellow`/`cata-fuchsia` undeclared as consumers, deferring "activate
the vibrant brand palette" as a separate change. Commit `3c3ef24` ("apply v4
vibrant red across admin panel accents") only activated the vibrant palette
on the public landing page — the admin panel's `cata-red` token is still
`#8B1A1A` today, confirmed live. This leaves the panel visually
inconsistent with the approved v4 brand (`#D92128` red, `#FFD600` yellow,
`#E5397D` fuchsia) that the landing page already ships, and two declared
tokens (`cata-yellow`, `cata-fuchsia`) sit unused in `tailwind.config.ts`.
This change activates the vibrant red ramp for real, and gives yellow and
fuchsia their first concrete, accessible use case each — closing the gap
Track A left open, without expanding into new UI surfaces or components.

## Scope

### In Scope
- `tailwind.config.ts`: update `cata.red` to `#D92128`, define
  `cata.red-light` and `cata.red-dark` (see Approach for derivation).
  `cata.yellow` (`#FFD600`) and `cata.fuchsia` (`#E5397D`) keep their
  existing hex values unchanged — only their *consumption* changes.
- `src/app/globals.css`: update the 4 hardcoded red literal patterns in
  `.btn-primary` / `.btn-primary:hover` / `.input-field:focus` (5
  occurrences total — `#8B1A1A` is used twice) to the new vibrant values.
- `src/components/Header.tsx`, narrowly: recolor the existing "Demo" badge
  (2 instances) to use `cata-yellow` + black text, and recolor the existing
  mobile-menu-toggle icon hover (2 instances) to `cata-fuchsia`. No other
  part of Header.tsx (nav-link semantics, dark chrome background) changes.
- 9× `page.tsx` files (`dashboard`, `trainer`, `trainer/attendance`,
  `attendance`, `student`, `student/enroll`, `payments`, `groups`,
  `members`): replace the duplicated inline
  `bg-[radial-gradient(circle_at_80%_20%,rgba(139,26,26,0.05),transparent_50%)]`
  literal with the existing dead `.bg-logo-glow` utility class (already
  defined in `globals.css` using the vibrant `rgba(217,33,40,...)` value —
  an abandoned prior attempt, never wired up until now).
- Post-implementation manual contrast spot-check of opacity-tinted
  `bg-cata-red/10`, `/15`, `/30` usages (badges/chips) — tracked as a
  verification task, not a merge blocker.

### Out of Scope (explicit non-goals)
- **New components, badges, banners, or UI surfaces.** This is activation
  of already-declared tokens on already-existing UI moments — not new
  feature or hierarchy work (that belongs to the parallel Track C,
  `admin-usability-heuristics`).
- **`cata-amber` (`#F4B41A`)** stays unused/dormant — no concrete use case
  identified for it in this change; not part of the user's activation
  request.
- **`Header.tsx`'s dark-chrome background and nav-link hover semantics**
  (`bg-cata-dark`, `hover:text-cata-red` on active/logout links) — out of
  scope, unchanged. Only the two narrow spots named above are touched.
- **Component extraction** (Button/Card/Badge/Input as React components) —
  still not started anywhere in the codebase; unrelated to this change.
- Capacity-bar colors in `groups-page-utils.ts` (theme-agnostic, untouched).

## Coordination with Track C (`admin-usability-heuristics`)

The 9 `page.tsx` files carrying the duplicated gradient literal are real,
direct file overlap with whatever Track C touches in those same page
bodies. This is isolated into its own PR (PR3, below) and must be
sequenced/communicated with whoever runs Track C — it is the only real
collision surface between the two changes. PR1 (config + globals.css) and
PR2 (Header.tsx) touch none of the 9 files and can proceed independently in
parallel with Track C without coordination.

## Capabilities

### New Capabilities
None — this modifies existing token values and existing component
consumption; it does not introduce a new capability boundary.

### Modified Capabilities
- `admin-light-theme` (declared by `design-system-migration`): the red
  primary-action hue moves from muted (`#8B1A1A`) to vibrant (`#D92128`),
  with a defined light/dark ramp. Yellow and fuchsia move from "declared,
  unused" to "declared, consumed" within the same accessibility contract
  Track A already established (status/accent colors must remain
  distinguishable and meet contrast, not decorative-only).

## Approach

### Red ramp derivation (explicit, reviewable)

The user resolved `cata-red-dark` directly: reuse `#A11D22`, the landing
page's existing hover/dark red variant (`--landing-brand-red-strong`) —
already vibrant, already shipped, no need to invent a new value.

`cata-red-light` has no landing precedent (landing only ships a darker
variant). Derivation method: compute HSL for both the new base red
(`#D92128`) and the now-fixed dark variant (`#A11D22`), find the lightness
delta between them, and mirror that same delta in the lighter direction
using the base hue/saturation. This keeps the ramp visually symmetric
around the base color instead of picking an arbitrary lighter hex by eye.

| Color | Hex | H | S | L |
|---|---|---|---|---|
| `cata-red` (base) | `#D92128` | 357.7° | 73.6% | 49.0% |
| `cata-red-dark` (fixed by user) | `#A11D22` | 357.7° | 69.5% | 37.3% |
| Lightness delta (dark vs. base) | — | — | — | −11.8pp |
| `cata-red-light` (mirrored, base H/S, L + 11.8pp) | **`#E55157`** | 357.7° | 73.6% | 60.8% |

Contrast check on `#E55157`: ratio vs. white/near-white is ≈3.7:1 — passes
AA for large text/UI components (3:1) but not small body text (4.5:1).
`cata-red-light`'s existing consumers are all hover/accent uses
(`.btn-secondary` hover background, `hover:text-cata-red-light` link hover
states, a login persona-swatch border/text) — none are small static body
text, so this is compatible with current usage, but is called out
explicitly as a constraint for any future consumer of this token.

Five files already reference `cata-red-light`/`hover:bg-cata-red-light`
today (`globals.css` `.btn-secondary`, `attendance/page.tsx`,
`register/page.tsx`, `student/enroll/page.tsx`, `login/page.tsx`) and will
pick up the new value automatically once the config changes — no edits
needed in those files themselves.

### Yellow activation: the "Demo" badge

`cata-yellow` (`#FFD600`) has zero consumers today. The existing "Demo"
badge in `Header.tsx` (rendered in both the loading-skeleton header and the
live header, 2 near-identical instances) currently uses generic Tailwind
`bg-amber-500/20 text-amber-400` — not any brand token at all. This is a
real, existing UI moment communicating "you are in demo/sample-data mode,"
a genuinely useful signal worth making on-brand and legible: swap it to a
solid `bg-cata-yellow` pill with black text (`text-cata-black`, per Track
A's established rule that yellow always pairs with black text). `#FFD600`
on `#111111` is a very high-contrast, fully accessible pairing (well above
AAA). This also increases the badge's visual weight from a subtle
translucent pill to a solid, attention-grabbing one — a deliberate choice
since "this is demo data" is worth surfacing clearly, not softly.

### Fuchsia activation: menu-toggle hover accent

`cata-fuchsia` (`#E5397D`) also has zero consumers today. Track A's
accessibility rule marks fuchsia as "accent/hover-only, never a block
color, borderline contrast with white text" — that borderline-contrast
warning applies to fuchsia-on-white (light surfaces), which is why this
change deliberately does **not** put fuchsia anywhere in the light-themed
page bodies. `Header.tsx`'s dark chrome (`bg-cata-dark`, near-black) is the
opposite case: fuchsia-on-dark computes to ≈4.9:1 contrast, comfortably
passing AA even for normal text. The mobile-menu-toggle icon buttons (2
instances, currently generic `hover:text-white`) are a small, self-contained
interactive element — recoloring their hover state to `cata-fuchsia`
activates the token as exactly the "hover/micro-interaction accent" it was
designed for, on the one surface in the codebase where it's demonstrably
safe, without touching the primary nav-link hover semantics (which stay
white/red) or introducing fuchsia as a block color anywhere.

### Sequencing: three small PRs

1. **PR1 — `tailwind.config.ts` + `globals.css`.** Isolated, zero
   component-file touch, defines the new red values. Reviewable in one
   pass; needs the red-ramp derivation above to already be agreed (it is,
   per this proposal).
2. **PR2 — `Header.tsx` (yellow + fuchsia activation).** Two narrow,
   unrelated className edits (Demo badge, menu-toggle hover). Zero
   dependency on PR1's token values (yellow/fuchsia hexes are unchanged),
   zero file overlap with Track C. Can ship before, after, or in parallel
   with PR1.
3. **PR3 — 9-file gradient-literal sweep.** Mechanical: replace the inline
   arbitrary-value gradient with `.bg-logo-glow`. Depends on PR1 having
   landed (the utility class's `rgba(217,33,40,...)` value should match the
   new `cata-red` for visual consistency, though technically decoupled
   since the utility hardcodes its own literal). Explicitly sequenced with
   Track C's owner since these are the same 9 files Track C's usability
   fixes touch.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `tailwind.config.ts` | Modified | `cata.red` → `#D92128`; add `red-light` (`#E55157`) / `red-dark` (`#A11D22`) |
| `src/app/globals.css` | Modified | 4 literal patterns (5 occurrences) in `.btn-primary`/`.input-field` → new red values |
| `src/components/Header.tsx` | Modified (narrow) | Demo badge → `cata-yellow`/black text; menu-toggle hover → `cata-fuchsia` |
| 9× `page.tsx` (dashboard, trainer, trainer/attendance, attendance, student, student/enroll, payments, groups, members) | Modified (mechanical) | Inline gradient literal → `.bg-logo-glow` |
| ~19 files using `bg-cata-red`/`text-cata-red`/`hover:*-cata-red-light` etc. | No edit | Inherit new values automatically via Tailwind config |
| `cata-amber`, capacity-bar colors, Header dark-chrome background | Untouched | Explicit non-goals |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Thin AA margin (~5.0:1 solid, ~3.7:1 for `red-light`) on light surfaces | Med | Documented explicitly above; opacity-tinted badge/chip usages get a manual post-implementation spot-check (verification task, not a blocker) |
| Mirrored-HSL derivation for `red-light` doesn't match designer intuition on sight | Low-Med | Flagged in the question round below; cheap to adjust the single config value if design sign-off disagrees |
| PR3 (9-file sweep) silently conflicts with Track C's concurrent edits to the same files | Med | Explicit sequencing/communication with Track C owner before PR3 starts; PR1/PR2 have zero overlap and don't need to wait |
| Making the "Demo" badge more visually prominent could read as unpolished during a live client demo | Low | Raised explicitly in the question round below for product sign-off |
| `Header.tsx` dark-chrome hover contrast for the *existing* red logout-hover slightly worsens (pre-existing condition, same token, unrelated to this PR's Header edits) | Low | Out of scope, not newly introduced by this change |

## Rollback Plan

Each PR is independently revertible (`git revert`) — PR1, PR2, and PR3 touch
disjoint concerns and mostly disjoint files (PR3 depends on PR1 landing
first for visual consistency, not functionally). Reverting PR1 alone
restores the muted red across every consumer at once, since all consumption
is via the Tailwind token, not hardcoded per-component.

## Dependencies

- None external. PR3 should land after PR1 (visual consistency between
  `.bg-logo-glow` and the new `cata-red`), and needs explicit sequencing
  with Track C. PR2 has no dependency on PR1 or PR3.

## Success Criteria

- [ ] `cata-red` renders as `#D92128` across all ~19 existing token
      consumers with no per-file edits beyond `tailwind.config.ts`.
- [ ] `cata-red-light` (`#E55157`) and `cata-red-dark` (`#A11D22`) are
      defined and documented with their derivation method.
- [ ] `globals.css`'s 4 hardcoded red literal patterns are gone; `.btn-primary`/`.input-field` use the new values.
- [ ] "Demo" badge renders solid `cata-yellow` + black text in both header
      states (loading skeleton, live).
- [ ] Mobile-menu-toggle icon hover renders `cata-fuchsia` on the dark
      header chrome.
- [ ] All 9 `page.tsx` files use `.bg-logo-glow` instead of the duplicated
      inline gradient literal.
- [ ] Manual contrast spot-check of `bg-cata-red/10`, `/15`, `/30` usages
      completed and documented (pass/needs-follow-up).
- [ ] `pnpm test` and `pnpm build` pass after each PR.

## Proposal question round

These are meant to sharpen product intent before writing specs/tasks — feel
free to answer, skip, correct the framing, or ask for a second round.

1. **Urgency/business driver**: Is there a specific reason this needs to
   ship now (an upcoming client-facing demo, stakeholder review, etc.), or
   is this purely closing technical debt Track A deferred, with no
   deadline pressure? This affects whether the 3-PR sequencing above is
   fine as-is or should be compressed.
2. **Demo badge prominence**: Making the "Demo" badge solid yellow + black
   (instead of the current subtle translucent amber pill) makes it more
   visually loud. Is drawing more attention to "you're in demo/sample
   data" desirable, or could a bolder badge look unpolished/alarming
   during a live client-facing demo? Should it stay subtle instead?
3. **PR ordering preference**: PR2 (Header yellow/fuchsia) has no technical
   dependency on PR1 (red ramp) — either can ship first. Is there a
   business reason to prioritize the red-ramp fix first (it's the far more
   visible, daily-use surface — buttons, badges, links) over the
   yellow/fuchsia polish, or does the order not matter to you?
4. **Computed color acceptance**: `cata-red-light` (`#E55157`) is derived
   algorithmically (mirrored HSL lightness), not eyeballed by a designer.
   Is shipping this computed value acceptable as a first pass, with
   refinement later if a designer disagrees on sight — or should design
   sign-off block this before PR1 merges?

**Confirmed by the user (2026-07-15)**: no hard deadline; badge boldness
(solid yellow + black text) is intentional and acceptable; PR order follows
the numbering above (PR1 red ramp first); the computed `#E55157` ships as
specified and is revisable later without blocking on design sign-off.
