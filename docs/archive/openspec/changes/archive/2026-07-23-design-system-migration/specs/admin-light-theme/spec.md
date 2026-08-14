# Admin Panel Theme Specification

## Purpose

Light-theme surface contract for the 13 admin panel views: foundation
tokens, shared classes, per-phase migration, bug fixes B1-B4, and
cross-cutting QA. Primary red `#8B1A1A` and capacity-bar colors stay
unchanged. Track B brand-hue activation and component extraction are
out of scope.

## Requirements

### Requirement: Foundation Light Tokens

The `cata-*` Tailwind namespace MUST include `bg #F9FAFB`, `surface #FFFFFF`,
`text #1F2937`, `border #E5E7EB`, and `state-ok #15803D`, with no `brand-*`
rename.

#### Scenario: New tokens available to Tailwind classes

- GIVEN `tailwind.config.ts` before this change
- WHEN the light tokens are added under `cata-*`
- THEN `bg-cata-bg`, `bg-cata-surface`, `text-cata-text`, `border-cata-border`,
  and `bg-cata-state-ok` compile as valid utility classes

### Requirement: Shared Component Classes Use Light Tokens

`globals.css` classes `.card`, `.btn-*`, `.input-field`, and `.badge-*` MUST
use the light tokens. Success-state badges MUST use `state-ok #15803D`
instead of generic rgba values.

#### Scenario: Card and input render on light surface

- GIVEN any view using `.card` or `.input-field`
- WHEN the view renders after Fase 0
- THEN its background/border resolve to `cata-surface`/`cata-border`, not
  `cata-dark`/`cata-navy`

#### Scenario: Success badge uses state-ok token

- GIVEN a `.badge-success` element
- WHEN it renders
- THEN its color resolves to `cata-state-ok #15803D`

### Requirement: Auth Screens Light Theme (Fase 1, B1, B2)

`login`, `register`, and `forgot-password` MUST render on light tokens with
no `cata-dark`/`cata-navy` classes. Demo role chips MUST use only colors
from the declared `cata-*` palette. Auth error banners MUST render via one
shared `.alert-error` class, with no duplicated inline markup.

#### Scenario: Login page renders light with palette-only chips

- GIVEN the login page after Fase 1
- WHEN it renders
- THEN no `cata-dark-*`/`cata-navy-*` classes remain
- AND each demo role chip's color is one defined in the `cata-*` namespace

#### Scenario: Login and register share the error banner class

- GIVEN `login/page.tsx` and `register/page.tsx`
- WHEN an auth error is shown
- THEN both use the same `.alert-error` class, with no duplicated banner
  markup in either file

### Requirement: Core Views Hero+Card Pattern (Fase 2, B3)

`dashboard`, `members`, and `groups` MUST share one light hero+card visual
pattern. Group-level badges MUST use `cata-*` brand tokens, not hardcoded
values. Capacity-bar colors in `groups-page-utils.ts` MUST NOT change.

#### Scenario: Dashboard, members, groups share the pattern

- GIVEN the three Fase 2 views after migration
- WHEN compared
- THEN all three use the same light hero-band and `.card` structure
- AND the groups page capacity-bar colors are byte-identical to before

#### Scenario: Group level badge resolves to a brand token

- GIVEN a group with an assigned level
- WHEN its badge renders
- THEN the badge color is a `cata-*` token, not a literal hex/rgba value

### Requirement: Payments/Attendance Table+Badge Pattern (Fase 3, B4)

`payments` and `attendance` status badges MUST use `state-ok` and equivalent
semantic tokens, not generic rgba values.

#### Scenario: Paid status uses state-ok

- GIVEN a payment row with status "paid"
- WHEN it renders
- THEN the badge uses the `state-ok #15803D` token

### Requirement: Status Distinguishable by Text, Not Color Alone

Paid, pending, and overdue statuses MUST be distinguishable via a visible
text label independent of badge color, meeting WCAG AA contrast.

#### Scenario: Status readable without color perception

- GIVEN a payment or attendance status badge
- WHEN color is removed or misperceived
- THEN the status is still identifiable from its text label alone

### Requirement: Trainer and Student Views Reuse Validated Patterns (Fase 4-5)

`trainer`, `trainer/attendance`, `student`, and `student/enroll` MUST reuse
the Fase 2/3 hero+card and badge patterns, with no new visual pattern
introduced.

#### Scenario: Trainer attendance matches Fase 3 badge pattern

- GIVEN `trainer/attendance` after migration
- WHEN compared to `attendance`
- THEN both use identical badge/status token usage

#### Scenario: Student enroll matches core light pattern

- GIVEN `student/enroll` after migration
- WHEN rendered
- THEN it uses `cata-surface`/`cata-border`/`cata-text` tokens with no
  `cata-dark`/`cata-navy` classes

### Requirement: Cross-Cutting Palette and Contrast Constraints (Fase 6)

No color outside `01-cata-club-design-system.pdf`'s palette MUST be
introduced. Yellow elements MUST pair with black text; red elements MUST
pair with white text.

#### Scenario: No off-palette colors, red-on-white contrast holds

- GIVEN all 13 migrated views
- WHEN their rendered colors are audited
- THEN every color maps to a declared palette token
- AND any red-background element uses white text

### Requirement: Responsive QA and Scope Boundary (Fase 6)

All 13 admin views MUST render correctly at mobile, tablet, and desktop
breakpoints. `products/page.tsx` MUST NOT receive theme migration work.

#### Scenario: View passes three-breakpoint check

- GIVEN any of the 13 migrated views
- WHEN viewed at mobile, tablet, and desktop widths
- THEN layout, contrast, and readability hold at each breakpoint

#### Scenario: Products page stays out of scope

- GIVEN `products/page.tsx`
- WHEN Fase 6 QA runs
- THEN it is confirmed redirect-only, with no light-token migration applied
</content>
