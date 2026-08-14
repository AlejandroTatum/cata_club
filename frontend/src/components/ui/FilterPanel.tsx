/**
 * FilterPanel — the one container for "this narrows the list below".
 *
 * The product had three homes for the same controls and two opposite orders.
 * Members put the search first and its chips on a second row, both loose on the
 * canvas; Payments put the chips first and the search underneath, also loose;
 * Attendance was the only screen that framed them, in a bordered panel with a
 * small-caps caption; Reports framed them too but with a different padding and
 * no caption. Same job, four answers.
 *
 * ## Why a `ui/` primitive and not "generalise AttendanceFilters"
 *
 * The panel chrome was never abstracted — `AttendanceFilters` is a DOMAIN
 * component (it owns the attendance query hook, the horario select and the
 * alumno typeahead) that happened to hold the chrome in a local class string.
 * Opening it up for Members, Payments and Reports would have dragged the
 * attendance vocabulary into three screens that have no horarios and no
 * alumno. The chrome comes out into this file instead, and
 * `AttendanceFilters` becomes one more caller.
 *
 * ## The order is the API
 *
 * The slots render in a fixed sequence — search, then chips, then fields, then
 * help — whatever order the caller writes the props in. That is deliberate: an
 * order kept by convention is the thing that drifted in the first place, and a
 * screen cannot express the wrong one here. The sequence goes from the fastest
 * question to the slowest: free text finds ONE record, a chip narrows a set,
 * and a named field is the deliberate, typed-out case. The caveat comes last,
 * because it is read after the controls it qualifies.
 *
 * ## D11c — the help does not live loose
 *
 * "La ayuda no vive suelta." `/members` shipped its "Ver ayuda" as a bare
 * child of the canvas, in a band of its own between this panel and the table,
 * held there by a margin nobody else in the column speaks. What it opens is a
 * caveat about what the search can REACH — "este listado puede incluir hasta
 * 200 registros" — so the block it belongs to is the block that searches, and
 * that is this one. The panel is also the only part of the screen that renders
 * in every state, which is what keeps the caveat on screen in the case that
 * needs it most: a search that found nobody.
 *

 * The panel carries NO margin of its own. The shell's `<main>` is a
 * `flex flex-col gap-page` column, so a margin here would be added on top of
 * the 20px step instead of replacing it; a screen that still spaces itself by
 * hand passes its own through `className`, which MERGES with the base classes
 * rather than replacing them.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

/** The small-caps caption used for every group inside the panel. */
export const FILTER_LABEL = "text-2xs font-bold uppercase text-ink-3";

/** What makes the panel read as a panel, on either axis. See the note on margins above. */
const PANEL = "gap-4 card p-[18px]";

/**
 * The two axes, and why the axis is a prop while the ORDER never is.
 *
 * A column is right for a rail and wrong for a page. `/attendance` drew this
 * component full width and stacked: 254px of a 900px viewport spent on three
 * controls crammed into the left 320px, with the entire right half of the card
 * empty — the "espacios vacíos" reproche, inside the block that is supposed to
 * be dense. The trainer's attendance history draws the SAME component in the
 * left third of its layout, where the column is the only thing that fits, which
 * is why this could not be fixed by simply changing the default.
 *
 * What moves is the axis. What does not move is the sequence — search, chips,
 * fields, then the caveat — because "a screen cannot express the wrong order"
 * is the entire reason the panel exists, and an escape hatch that also reorders
 * would hand back exactly what was taken away. Flowing keeps the help on its
 * own full-width line: it qualifies the controls, so it is read after them, not
 * beside them.
 */
const AXIS = {
  column: "flex flex-col",
  row: "grid sm:grid-cols-2 lg:grid-cols-3 items-start",
} as const;

export type FilterPanelLayout = keyof typeof AXIS;

/**
 * The search slot is width-capped HERE and not by each caller. Members wrote
 * `max-w-xs`, Payments `max-w-[320px]` and Niveles `max-w-sm` for the same
 * field — the first two being the same 320px spelled two ways.
 */
const SEARCH_WIDTH = "max-w-xs";

export interface FilterPanelProps {
  /** Accessible name of the region, e.g. "Filtros de miembros". */
  label: string;
  /** Slot 1 — the free-text finder. Rendered width-capped. */
  search?: ReactNode;
  /** Slot 2 — the chip row, and any range the chips open. */
  chips?: ReactNode;
  /** Slot 3 — selects, dates, anything carrying its own field caption. */
  fields?: ReactNode;
  /**
   * Slot 4 — a `ContextualHelp` disclosure qualifying what the controls above
   * can reach. See the note on D11c below.
   */
  help?: ReactNode;
  /**
   * `column` (default) stacks the slots — the shape a rail needs. `row` flows
   * the control slots across the panel's width, for a panel that spans a page.
   * The slot order is identical either way. See the note on `AXIS` above.
   */
  layout?: FilterPanelLayout;
  /** Merged with the base classes, never replacing them. */
  className?: string;
}

export function FilterPanel({
  label,
  search,
  chips,
  fields,
  help,
  layout = "column",
  className,
}: FilterPanelProps): ReactElement {
  const flowing = layout === "row";

  return (
    <section aria-label={label} className={cn(PANEL, AXIS[layout], className)}>
      {/* Flowing, the search is one track of the grid and the grid owns its
          width; capping it again at 320px would leave a hole inside its own
          column. Stacked, the cap is what stops a full-width text field from
          reading as the panel's headline. */}
      {search ? <div className={flowing ? undefined : SEARCH_WIDTH}>{search}</div> : null}
      {chips}
      {fields}
      {/* The caveat is read after the controls, so it never shares a row with
          them — it takes the full width at the foot on both axes. */}
      {help ? <div className={flowing ? "sm:col-span-full" : undefined}>{help}</div> : null}
    </section>
  );
}

export interface FilterGroupProps {
  /** The small-caps caption, e.g. "Rango de fechas". */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A captioned block inside the panel. It is a `<div>` and not a `<fieldset>`
 * because the things it captions are not always form controls — the date
 * presets are toggle buttons — and a caption is all that is being asked for.
 */
export function FilterGroup({ label, children, className }: FilterGroupProps): ReactElement {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className={FILTER_LABEL}>{label}</span>
      {children}
    </div>
  );
}
