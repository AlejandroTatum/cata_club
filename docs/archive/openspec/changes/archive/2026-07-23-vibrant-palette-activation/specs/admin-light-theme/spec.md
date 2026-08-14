# Admin Panel Theme Specification (Delta — Vibrant Palette Activation)

## Purpose

This is a delta to the `admin-light-theme` capability declared by
`design-system-migration`. It activates the vibrant v4 brand red ramp
(`#D92128`/`#A11D22`/`#E55157`) in place of the muted red (`#8B1A1A`) the
base spec fixed, and gives the previously-declared-but-unused
`cata-yellow`/`cata-fuchsia` tokens their first concrete consumers. It does
not introduce a new capability boundary, new components, or new UI
surfaces. `cata-amber`, `groups-page-utils.ts` capacity-bar colors, and
`Header.tsx`'s dark-chrome background / primary nav-link hover semantics
remain unchanged, per the base spec and this proposal's non-goals.

## MODIFIED Requirements

### Requirement: Foundation Light Tokens

The `cata-*` Tailwind namespace MUST define `cata-red` as `#D92128`,
`cata-red-dark` as `#A11D22`, and `cata-red-light` as `#E55157`. Every
existing consumer of these tokens (utility classes such as `bg-cata-red`,
`text-cata-red`, `hover:bg-cata-red-light`, `focus:ring-cata-red/30`, and
component classes such as `.btn-primary`) MUST resolve to the new values
without any per-consumer file edit — token consumption is exclusively
through Tailwind's generated utilities and `@apply`, never through
duplicated hex literals in consumer files. All other Foundation Light
Tokens defined by the base spec (`bg`, `surface`, `text`, `border`,
`state-ok`) are unchanged by this delta.

#### Scenario: Red ramp resolves to vibrant values via config alone

- GIVEN `tailwind.config.ts` with `cata.red: "#D92128"`, `cata["red-dark"]: "#A11D22"`, `cata["red-light"]: "#E55157"`
- WHEN any existing consumer class (`bg-cata-red`, `text-cata-red`, `hover:bg-cata-red-light`, `hover:text-cata-red-light`, `border-cata-red`, `focus:ring-cata-red/30`) is rendered anywhere in the codebase
- THEN it resolves to the new vibrant hex value
- AND no source file other than `tailwind.config.ts` requires an edit for that consumer to pick up the change

#### Scenario: Red-dark and red-light values match the documented derivation

- GIVEN `tailwind.config.ts` after this change
- WHEN `cata.red-dark` and `cata.red-light` are inspected
- THEN `cata.red-dark` equals `#A11D22` (reused from the landing page's existing dark-red variant)
- AND `cata.red-light` equals `#E55157` (mirrored-HSL lightness delta around the new base red)

### Requirement: Shared Component Classes Use Light Tokens

`globals.css` classes `.btn-primary`, `.btn-primary:hover`, and
`.input-field:focus` MUST use the new vibrant red token values with no
hardcoded literal (hex or `rgba(...)`) red patterns remaining anywhere in
`globals.css`. This extends the base spec's requirement that shared
component classes use light tokens (`.card`, `.input-field` base state,
`.badge-*` remain as fixed by the base spec, unchanged by this delta).

#### Scenario: No hardcoded red literals remain in globals.css

- GIVEN `src/app/globals.css` after this change
- WHEN the file is searched for the muted red literal (`#8B1A1A`) or its associated `rgba(139,26,26,...)` forms
- THEN zero occurrences are found in `.btn-primary`, `.btn-primary:hover`, or `.input-field:focus`
- AND those rules reference the vibrant `cata-red`/`cata-red-dark` values instead (via token, `@apply`, or an updated literal matching the new hex/rgba)

#### Scenario: Primary button renders vibrant red at rest and on hover

- GIVEN a `.btn-primary` element
- WHEN it renders in its default state
- THEN its background color is `#D92128` (`cata-red`)
- WHEN it is hovered
- THEN its background color is `cata-red-light` (already applied via `hover:bg-cata-red-light`) and its box-shadow/hover accent no longer references the muted `rgba(139,26,26,...)` value

#### Scenario: Input focus ring uses vibrant red

- GIVEN an `.input-field` element
- WHEN it receives focus
- THEN its `border-color` and `box-shadow` resolve to the new vibrant red (`cata-red`), not `#8B1A1A` or `rgba(139,26,26,...)`

## ADDED Requirements

### Requirement: Demo Badge Uses Activated Yellow Token

The "Demo" badge in `Header.tsx` MUST render with a solid `cata-yellow`
(`#FFD600`) background and black (`cata-black`) text in both places it
appears: the loading-skeleton header and the live authenticated header. It
MUST NOT use generic Tailwind amber utilities (`bg-amber-500/*`,
`text-amber-400`).

#### Scenario: Demo badge in loading-skeleton header

- GIVEN `Header.tsx` while `isLoading` is true (skeleton header)
- WHEN the "Demo" badge renders
- THEN its background resolves to `cata-yellow` (`#FFD600`)
- AND its text color resolves to `cata-black` (`#111111`)
- AND no `bg-amber-*`/`text-amber-*` class remains on that element

#### Scenario: Demo badge in live authenticated header

- GIVEN `Header.tsx` in its live (non-loading) authenticated state
- WHEN the "Demo" badge renders
- THEN its background resolves to `cata-yellow` (`#FFD600`)
- AND its text color resolves to `cata-black` (`#111111`)
- AND no `bg-amber-*`/`text-amber-*` class remains on that element

### Requirement: Mobile Menu Toggle Uses Activated Fuchsia Hover Accent

The mobile-menu-toggle icon button(s) in `Header.tsx` MUST render
`cata-fuchsia` (`#E5397D`) as their hover accent color, replacing the
generic `hover:text-white` state, on the dark header chrome
(`bg-cata-dark`) where fuchsia-on-dark contrast is accessible.
`cata-fuchsia` MUST NOT be introduced anywhere in the light-surfaced page
bodies (the 13 admin views governed by the base `admin-light-theme` spec) —
it remains confined to this one dark-chrome hover accent, per the
accessibility constraint that fuchsia-on-white/light-surface contrast is
borderline and unsuitable as a light-surface color.

#### Scenario: Menu-toggle icon hover renders fuchsia on dark chrome

- GIVEN the mobile-menu-toggle `<button>` in `Header.tsx`
- WHEN it is hovered
- THEN its icon/text color resolves to `cata-fuchsia` (`#E5397D`)
- AND the button's surrounding chrome remains `bg-cata-dark`/near-black (unchanged)

#### Scenario: Fuchsia does not appear in light-surfaced page bodies

- GIVEN all 13 admin views governed by the base `admin-light-theme` spec (dashboard, members, groups, payments, attendance, trainer, trainer/attendance, student, student/enroll, login, register, forgot-password, and any other light-surfaced view)
- WHEN their rendered markup is audited for color classes
- THEN no `cata-fuchsia` class (background, text, border, or ring) is present in any of them

### Requirement: Duplicated Inline Gradient Literal Replaced by Utility Class

The 9 `page.tsx` files (`dashboard`, `trainer`, `trainer/attendance`,
`attendance`, `student`, `student/enroll`, `payments`, `groups`, `members`)
MUST use the `.bg-logo-glow` utility class instead of their duplicated
inline `bg-[radial-gradient(circle_at_80%_20%,rgba(139,26,26,0.05),transparent_50%)]`
literal, with the visually rendered gradient held equivalent (radial red
glow at low opacity) before and after the swap.

#### Scenario: Page uses .bg-logo-glow instead of the inline literal

- GIVEN any of the 9 named `page.tsx` files
- WHEN its background-gradient element is inspected
- THEN it uses the `.bg-logo-glow` class
- AND no inline `bg-[radial-gradient(...rgba(139,26,26,...)...)]` arbitrary-value literal remains in that file

#### Scenario: Rendered visual result is unchanged

- GIVEN a page before this change (inline gradient literal) and the same page after this change (`.bg-logo-glow`)
- WHEN both are rendered
- THEN the visible radial glow position, size, and color intent are equivalent (a subtle red-tinted radial glow), consistent with `.bg-logo-glow`'s definition in `globals.css`

### Requirement: Red-on-Light-Surface Contrast Constraint

Every `cata-red`/`cata-red-light`/`cata-red-dark` usage on a light surface
(`cata-bg`/`cata-surface`/white) MUST meet at least WCAG AA for its actual
usage context: solid-background components (buttons, solid badges) MUST
meet the 3:1 non-text/UI-component threshold at minimum, and any usage as
small static body text MUST meet the 4.5:1 text threshold. `cata-red-light`
(`#E55157`, ≈3.7:1 against white) is documented as suitable for hover/accent
UI-component usage only and MUST NOT be introduced as small static body
text on a light surface.

#### Scenario: Solid red button meets AA for UI components

- GIVEN `.btn-primary` at rest (`cata-red` `#D92128` on white/light surroundings)
- WHEN its contrast ratio is measured
- THEN it is at least 3:1 (and in practice ≈5:1, per the proposal's documented derivation), satisfying WCAG AA for solid UI components

#### Scenario: Red-light hover/accent stays within its documented usage class

- GIVEN every existing consumer of `cata-red-light` (`.btn-secondary` hover background, `hover:text-cata-red-light` link/nav hover states, login persona-swatch border/text)
- WHEN each consumer is inspected
- THEN none renders `cata-red-light` as small static body text on a light surface
- AND each stays within the hover/accent/UI-component usage class where ≈3.7:1 contrast is the accepted, documented threshold

## Non-Goals Reaffirmed (unchanged by this delta)

- `cata-amber` (`#F4B41A`) stays unused/dormant.
- Capacity-bar colors in `groups-page-utils.ts` are byte-identical to
  before this change.
- `Header.tsx`'s dark-chrome background (`bg-cata-dark`) and primary
  nav-link hover semantics (`hover:text-white` on non-toggle nav links,
  `hover:text-cata-red` on the logout link) are untouched.
- `products/page.tsx` remains redirect-only, unmigrated (per the base
  spec's Responsive QA and Scope Boundary requirement).
