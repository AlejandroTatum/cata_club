/**
 * StatGrid — the count grid that replaces a sentence like "17 presente •
 * 4 ausente • 4 tardanza • 4 justificado", where four values hide inside a
 * sentence and a reader has to READ them one at a time instead of seeing
 * them at a glance.
 *
 * The number itself is never colored. `StatCard` already states the rule
 * this component inherits: coloring a figure implies a judgment ("is 86
 * good?") that a plain count almost never carries. An attendance count is
 * no exception — 4 ausencias is not "bad 4" the way a red number would
 * claim; the CATEGORY the count belongs to is what already carries meaning
 * in this system (the same presente/ausente/tardanza pairs `Badge` uses), so
 * the color goes on the category's own label and dot, exactly where badges
 * already put it. `StatGrid` reuses `DataBox` unmodified for the figure —
 * no new "colored number" variant was added, on purpose.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";
import DataBox from "./DataBox";
import type { BadgeTone } from "./Badge";

const LABEL_TONE: Record<BadgeTone, string> = {
  neutral: "text-ink-2",
  ok: "text-state-ok",
  warn: "text-state-warn",
  bad: "text-state-bad",
};

export interface StatGridItem {
  /** The category name, e.g. "Presente". Carries the color, not the value. */
  label: string;
  /** The figure. Kept as a node so callers can pass a formatted string. */
  value: ReactNode;
  /** One of the state pairs `Badge` already uses for this same vocabulary. */
  tone: BadgeTone;
}

export interface StatGridProps {
  items: StatGridItem[];
  className?: string;
}

export default function StatGrid({ items, className }: StatGridProps): ReactElement {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex flex-col items-center gap-1.5">
          <DataBox variant="numeric">{item.value}</DataBox>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-flat",
              LABEL_TONE[item.tone],
            )}
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
