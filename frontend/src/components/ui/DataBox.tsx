/**
 * DataBox — the box every standalone value sits in.
 *
 * The rule this component exists to enforce: a value nobody should have to
 * read as running prose gets its own box instead. It surfaced three times in
 * design review — age in a member list, a headcount in a table cell, the four
 * attendance counts on the confirmation screen — and all three read as bare
 * text before this existed.
 *
 * Default: `sunken` fill, `line` border, `ink-2` text, 3px corners. There is
 * no named 3px radius token (`rounded-card` is 14px, `rounded-ctl` is 10px),
 * so the corner is written as an explicit arbitrary value on purpose — it is
 * the box's own scale, not a step borrowed from the card/control ladder.
 *
 * `numeric` variant: monospaced, `tabular-nums`, centered, minimum width so a
 * single digit and a double digit line up, text in `ink`. Never a state or
 * brand color — same rule `StatCard` already states: a colored number implies
 * a judgment ("is 86 good?") that a plain count never carries. Where a value
 * DOES carry a judgment (attendance categories), the color belongs on the
 * category's own label and dot, not on the figure — see `StatGrid`.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export type DataBoxVariant = "default" | "numeric";

export interface DataBoxProps {
  children: ReactNode;
  variant?: DataBoxVariant;
  className?: string;
}

export default function DataBox({
  children,
  variant = "default",
  className,
}: DataBoxProps): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border border-line bg-sunken px-2 py-0.5 text-xs text-ink-2",
        variant === "numeric" &&
          "min-w-[2.5ch] justify-center font-mono tabular-nums text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}
