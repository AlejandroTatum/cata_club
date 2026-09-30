/**
 * ChartTooltip — the small dark label a chart shows for the part being read.
 *
 * It is purely visual: every hit target already carries the same sentence as
 * its accessible name, so the tooltip is `aria-hidden` and never the only way
 * to learn a figure. It ignores the pointer so it cannot steal the hover that
 * opened it.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "@/components/ui";

export interface ChartTooltipProps {
  /** CSS `left` of the tooltip's centre, e.g. "42%". */
  left: string;
  children: ReactNode;
  className?: string;
}

export default function ChartTooltip({ left, children, className }: ChartTooltipProps): ReactElement {
  return (
    <div
      data-testid="chart-tooltip"
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-coal px-2.5 py-1.5 text-xs text-white",
        className,
      )}
      style={{ left }}
    >
      {children}
    </div>
  );
}
