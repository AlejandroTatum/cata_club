/**
 * DataRow — the dense list row design review picked over the avatar card.
 *
 * With 86 members on one screen, a card forces twice the scrolling a row
 * does. `DataRowList` is the outer frame (a border, hairline separators
 * between rows); `DataRow` is one row: identity in semibold, metadata boxed
 * by the caller (typically `DataBox`), an optional status badge, and trailing
 * actions.
 *
 * `variant="two-line"` is the SAME component at a second density, not a
 * second component — it swaps the metadata slot for a single muted subtitle
 * under the name, for the case where there is exactly one more fact to show
 * and it reads better as a caption than as a second box.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export type DataRowVariant = "dense" | "two-line";

export interface DataRowProps {
  /** The row's identity — rendered in semibold. */
  name: ReactNode;
  /**
   * Dense variant only: the row's boxed metadata (typically one or more
   * `DataBox` values). Ignored in the two-line variant — use `subtitle`.
   */
  meta?: ReactNode;
  /** Two-line variant only: the muted line under the name. */
  subtitle?: ReactNode;
  /** An optional status badge. */
  status?: ReactNode;
  /** Trailing actions. */
  actions?: ReactNode;
  variant?: DataRowVariant;
  className?: string;
}

export default function DataRow({
  name,
  meta,
  subtitle,
  status,
  actions,
  variant = "dense",
  className,
}: DataRowProps): ReactElement {
  const twoLine = variant === "two-line";

  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-field px-4 py-3", className)}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{name}</p>
        {twoLine && subtitle ? (
          <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p>
        ) : null}
      </div>

      {!twoLine && meta ? (
        <div className="flex flex-none flex-wrap items-center gap-2">{meta}</div>
      ) : null}

      {status ? <div className="flex-none">{status}</div> : null}
      {actions ? <div className="flex flex-none items-center gap-2">{actions}</div> : null}
    </li>
  );
}

/** The outer frame every `DataRow` list shares: a border and inner hairlines. */
export function DataRowList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <ul className={cn("divide-y divide-line overflow-hidden rounded-card border border-line", className)}>
      {children}
    </ul>
  );
}
