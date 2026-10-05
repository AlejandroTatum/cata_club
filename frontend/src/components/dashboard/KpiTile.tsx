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
import { STAT_TONE, STATUS_INK, cn, type StatCardToneProps } from "@/components/ui";

/**
 * The colour rule is the one `StatCard` states: the tone is the meaning of
 * the datum (never the viewer's role), the figure stays ink, and a toned tile
 * says its state in a word. `variant="hot"` is the single coal «needs action»
 * tile of a row — its picture sits on a paper inset, drawn for a light surface.
 */
export type KpiTileProps = KpiTileBaseProps & StatCardToneProps & { variant?: "default" | "hot" };

interface KpiTileBaseProps {
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
  variant = "default",
  tone = "neutral",
  status,
}: KpiTileProps): ReactElement {
  const hot = variant === "hot";
  const toned = !hot && tone !== "neutral";

  return (
    <div
      data-testid="kpi-tile"
      data-tone={hot ? "action" : tone}
      className={cn(
        "flex min-h-stat flex-col justify-between gap-3 rounded-card border px-[18px] py-4",
        hot ? "border-coal bg-coal" : toned ? cn("border-line border-t-[3px]", STAT_TONE[tone].accent) : "border-line bg-paper",
        className,
      )}
    >
      <span className={cn("text-2xs font-bold uppercase", hot ? "text-white/60" : "text-ink-3")}>{label}</span>

      <div className={cn("flex gap-3", visualPlacement === "side" ? "flex-wrap items-center justify-between" : "flex-col")}>
        <span className={cn("font-display text-2xl leading-none tabular-nums tracking-flat", hot ? "text-white" : "text-ink")}>
          {value}
          {unit ? <small className={cn("ml-[3px] font-sans text-sm font-semibold", hot ? "text-white/60" : "text-ink-3")}>{unit}</small> : null}
        </span>
        {/* The picture is drawn for a light surface, so on the coal tile it
            keeps its own paper inset instead of being redrawn. */}
        {visual ? (
          <div className={cn(visualPlacement === "side" ? "w-28 flex-none" : "w-full", hot && "rounded-ctl bg-paper p-2")}>
            {visual}
          </div>
        ) : null}
      </div>

      {status ? (
        <span
          data-testid="kpi-status"
          className={cn("flex items-center gap-1.5 text-xs font-semibold", hot ? "text-white" : STATUS_INK[tone])}
        >
          <span
            data-testid={hot ? "kpi-ball-dot" : undefined}
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 flex-none rounded-full", hot ? "bg-ball" : "bg-current")}
          />
          {status}
        </span>
      ) : null}

      {href ? (
        <Link
          href={href}
          className={cn(
            "touch-target-row inline-flex items-center gap-1.5 text-xs font-semibold underline-offset-2 hover:underline",
            hot ? "text-white/80 hover:text-white" : "text-ink-2 hover:text-ink",
            captionClassName,
          )}
        >
          {caption}
          <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        </Link>
      ) : (
        <span className={cn("text-xs", hot ? "text-white/60" : "text-ink-3")}>{caption}</span>
      )}
    </div>
  );
}
