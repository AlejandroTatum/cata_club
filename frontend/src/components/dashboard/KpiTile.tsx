/**
 * KpiTile — a pulse figure with its own small picture.
 *
 * `StatCard` states a number and, at most, a one-line hint; the dashboards
 * that follow the student idiom want the figure and the shape it comes from
 * side by side: the count on the left, a ring / a few bars / a split on the
 * right, and one caption line that can be a link into the module.
 *
 * The tile is NOT one big link: its picture holds focusable parts (columns,
 * segments) and a link cannot contain those. The way into the module is the
 * caption link instead.
 */

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { cn } from "@/components/ui";

export interface KpiTileProps {
  /** Uppercase key, e.g. "Membresías activas". */
  label: string;
  value: ReactNode;
  /** Small unit after the figure: "%" or "de 40". */
  unit?: string;
  /** The picture: a `Ring`, `Bars` or `SegmentBar`. */
  visual?: ReactNode;
  /** Where the picture sits relative to the figure. `below` for wide pictures. */
  visualPlacement?: "side" | "below";
  /** Bottom line. With `href` it becomes a link into the module. */
  caption: ReactNode;
  href?: string;
  /** Extra classes for the caption link, e.g. a taller tap area on phones. */
  captionClassName?: string;
  className?: string;
}

export default function KpiTile({
  label,
  value,
  unit,
  visual,
  visualPlacement = "side",
  caption,
  href,
  captionClassName,
  className,
}: KpiTileProps): ReactElement {
  return (
    <div
      data-testid="kpi-tile"
      className={cn("flex min-h-stat flex-col justify-between gap-3 rounded-card border border-line bg-paper px-[18px] py-4", className)}
    >
      <span className="text-2xs font-bold uppercase text-ink-3">{label}</span>

      <div className={cn("flex gap-3", visualPlacement === "side" ? "flex-wrap items-center justify-between" : "flex-col")}>
        <span className="font-display text-2xl leading-none tabular-nums tracking-flat text-ink">
          {value}
          {unit ? <small className="ml-[3px] font-sans text-sm font-semibold text-ink-3">{unit}</small> : null}
        </span>
        {visual ? <div className={cn(visualPlacement === "side" ? "w-28 flex-none" : "w-full")}>{visual}</div> : null}
      </div>

      {href ? (
        <Link href={href} className={cn("inline-flex items-center gap-1.5 text-xs font-semibold text-ink-2 underline-offset-2 hover:text-ink hover:underline", captionClassName)}>
          {caption}
          <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        </Link>
      ) : (
        <span className="text-xs text-ink-3">{caption}</span>
      )}
    </div>
  );
}
