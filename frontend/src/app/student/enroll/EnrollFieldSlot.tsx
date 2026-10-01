/**
 * Reserves the vertical room of one field — label, control and a line of
 * message — so an inline error appearing under a field that had no hint does
 * not push the rest of the step down. `min-h-22` (88px) is that measure; a
 * field with a taller message (a wrapped error, the birth-date fieldset)
 * simply grows past it.
 */

import type { ReactElement, ReactNode } from "react";

export default function FieldSlot(props: {
  children: ReactNode;
}): ReactElement {
  return <div className="min-h-22">{props.children}</div>;
}

/**
 * Two fields side by side from `md`, packed from the top with the step's normal
 * rhythm. `-mb-4` cancels the last field's own `mb-4`, so whatever follows the
 * grid sets the distance instead of adding to it.
 */
export function EnrollFieldGrid(props: { children: ReactNode }): ReactElement {
  return (
    <div className="grid gap-x-page -mb-4 gap-y-4 md:grid-cols-2 md:items-start">
      {props.children}
    </div>
  );
}
