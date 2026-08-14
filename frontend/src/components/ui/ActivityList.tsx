/**
 * ActivityList — the "something happened" list, which is NOT a table.
 *
 * The consistency pass asked every tabular list in the product to use
 * `ui/Table`. This one was the case where that would have been a lie, and the
 * issue said so itself: *"puede ser legítimo que no sea una tabla, pero
 * entonces debe existir una primitiva de lista de actividad en vez de markup
 * suelto"*.
 *
 * It is not a table, measured rather than asserted. A table row is the same
 * fields in the same columns every time; this row is an actor's mark, ONE
 * variable-width sentence, and a timestamp. There are no columns to align — the
 * middle is a sentence that wraps — so a `<thead>` would name nothing and a
 * fixed column track would only stop the sentence from using the width it has.
 * `docs/archive/prototypes/prototipos/_sistema.css` already draws it as its own thing (`.feed
 * .it`, :269), separate from `.tbl`.
 *
 * What it was NOT allowed to keep is being loose markup: the dashboard hand-
 * wrote this shape with its own `py-3`, which is how the product came to have
 * three different row heights. The height is `min-h-drow` — the dense-row
 * token, since this is a secondary list inside a card rather than the list a
 * screen exists for. See the note beside `height` in `tailwind.config.ts`.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

/**
 * The card's own gutter, shared with the header row above the list so the
 * actor marks line up with the section title. Not a token: 18px has no step in
 * the spacing scale, and inventing one for a single card would be a token
 * nobody else could use correctly.
 */
const GUTTER = "px-[18px]";

export function ActivityList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactElement {
  return <ul className={cn("divide-y divide-line", className)}>{children}</ul>;
}

export interface ActivityItemProps {
  /** The actor's mark. Decorative — the subject already names them in text. */
  initials: string;
  /** Who or what the event is about: the bold lead of the sentence. */
  subject: ReactNode;
  /** What happened, continuing the same sentence as `subject`. */
  detail: ReactNode;
  /** When, already humanised by the caller ("Hoy, 23 jul"). */
  at: ReactNode;
}

export function ActivityItem({
  initials,
  subject,
  detail,
  at,
}: ActivityItemProps): ReactElement {
  return (
    <li className={cn("flex min-h-drow items-center gap-3 py-3", GUTTER)}>
      {/* `aria-hidden`: the initials are a visual anchor for a name the
          sentence beside them already says in full. Announcing "SG" before
          "Sofía González" is the same fact twice, the second time as noise. */}
      <span
        aria-hidden="true"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-canvas text-2xs tracking-flat font-bold text-ink-2"
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1 text-sm text-ink-2">
        <b className="font-semibold text-ink">{subject}</b> {detail}
      </span>
      <span className="flex-none text-2xs tracking-flat text-ink-3">{at}</span>
    </li>
  );
}

/** The header row above the list, on the card's own gutter. */
export function ActivityListHeader({
  title,
  action,
}: {
  title: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className={cn("flex items-center gap-3 border-b border-line py-4", GUTTER)}>
      <h2 className="flex-1 text-base font-bold text-ink">{title}</h2>
      {action}
    </div>
  );
}
