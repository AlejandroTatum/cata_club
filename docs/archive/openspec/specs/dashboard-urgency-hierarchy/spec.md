# Dashboard Urgency Hierarchy Specification

## Purpose

Visual contract for `dashboard/page.tsx` distinguishing informational stat
cards from actionable quick-action cards, and giving the 2 alert-flagged
stats ("pendientes de validar", "pagos pendientes") a visual priority beyond
today's small corner badge — styling only, no reordering.

## Requirements

### Requirement: Stat Cards Are Visually Distinguishable from Quick-Action Cards

The 4 stat cards and 4 quick-action cards MUST use a visually distinguishable
container treatment from each other (beyond the current shared
`.card-hover`, icon treatment, and a trailing arrow/`<Link>` wrapper), so a
user can tell "informational" apart from "actionable" without reading text.

#### Scenario: Stat and quick-action cards read as different content types

- GIVEN the dashboard renders its 4 stat cards and 4 quick-action cards
- WHEN a user scans the grid
- THEN stat cards and quick-action cards are distinguishable by container
  styling alone, not only by a trailing arrow

### Requirement: Alert-Flagged Stats Receive Escalated Styling

The 2 alert-flagged stat cards (currently marked only with a small amber
corner badge) MUST receive escalated styling — larger card, bolder border,
and/or stronger icon color, using existing `cata-yellow`/`cata-red` tokens —
so they read as higher priority than the other 2 stat cards.

#### Scenario: Alert-flagged stat is visually escalated

- GIVEN a stat card flagged as needing attention (e.g. "3 pendientes de
  validar")
- WHEN the dashboard renders
- THEN that card's border, size, and/or icon color are visibly stronger than
  a non-flagged stat card

#### Scenario: Non-flagged stats keep baseline styling

- GIVEN a stat card with no alert flag
- WHEN the dashboard renders
- THEN that card retains the pre-change baseline card treatment

### Requirement: Escalation Is Styling-Only, No Reorder

Escalated styling MUST NOT change the DOM/render order or grid position of
any stat card. The 2 alert-flagged stats MUST remain in their existing
position within the stat-card grid.

#### Scenario: Card order is unchanged

- GIVEN the dashboard's stat-card grid before and after this change
- WHEN the DOM order of the 4 stat cards is compared
- THEN the order is identical

### Requirement: No Tailwind Config Changes

Escalated and differentiated styling MUST use only existing `cata-*` classes
and MUST NOT add, rename, or remove any entry in `tailwind.config.ts`.

#### Scenario: Config diff stays empty

- GIVEN this capability's implementation is complete
- WHEN `tailwind.config.ts` is diffed against its pre-change state
- THEN the diff is empty
