/**
 * CompactEmpty — the empty state of a dashboard block, in one line.
 *
 * A dashboard block that has nothing to show should say so and step aside; a
 * tall illustrated empty card pushes the rest of the column down and leaves the
 * neighbouring column with a hole beside it. This is the title, one muted line
 * of hint and, when there is a next step, its action.
 */

import type { ReactElement, ReactNode } from "react";

export interface CompactEmptyProps {
  title: string;
  description?: string;
  /** The one next step, when there is one. */
  action?: ReactNode;
}

export default function CompactEmpty({ title, description, action }: CompactEmptyProps): ReactElement {
  return (
    <div
      data-testid="compact-empty"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-[18px] py-3.5 text-sm"
    >
      <span className="font-semibold text-ink">{title}</span>
      {description ? <span className="min-w-0 flex-1 text-ink-2">{description}</span> : null}
      {action}
    </div>
  );
}
