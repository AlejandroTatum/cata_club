/**
 * KpiTile — a pulse figure with its own small picture.
 *
 * `StatCard` states a number and, at most, a one-line hint; the dashboards
 * that follow the student idiom want the figure and the shape it comes from
 * side by side: the count on the left, a ring / a few bars / a split on the
 * right, and one caption line that can be a link into the module.
 *
 * It is a solid brand block (see `STAT_BLOCK`): red, ball or coal with the
 * landing's sticker frame, the figure big, a vertical divider and the
 * letter-spaced label beside it. A neutral tile is the quiet white sticker.
 *
 * The tile is NOT one big link: its picture holds focusable parts (columns,
 * segments) and a link cannot contain those. The way into the module is the
 * caption link instead.
 */

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import {
  STAT_BLOCK,
  STAT_BLOCK_FOR_TONE,
  STAT_BLOCK_FRAME,
  cn,
  type StatCardToneProps,
} from "@/components/ui";

/**
 * The colour rule is the one `StatCard` states: the tone is the meaning of
 * the datum (never the viewer's role), and a toned tile says its state in a
 * word. The tone picks the block's face; `variant="hot"` is the single coal
 * «needs action» tile of a row. The picture is drawn for a light surface, so
 * on any solid face it sits on a paper inset.
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
  const skin = STAT_BLOCK[hot ? "coal" : STAT_BLOCK_FOR_TONE[tone]];
  const solid = hot || tone !== "neutral";

  return (
    <div
      data-testid="kpi-tile"
      data-tone={hot ? "action" : tone}
      className={cn(
        "flex min-h-stat flex-col justify-between gap-3 px-[18px] py-4",
        STAT_BLOCK_FRAME,
        skin.surface,
        className,
      )}
    >
      {/* Figure | divider | label — the landing's stat tile. The divider is the
          label's own left border and the row wraps, so in a narrow tile the
          label drops under the figure instead of pushing the grid wider. */}
      <div className="flex flex-wrap items-stretch gap-x-3 gap-y-2">
        <span className="font-display text-display leading-none tabular-nums tracking-flat">
          {value}
          {unit ? <small className={cn("ml-[3px] font-sans text-sm font-semibold", skin.muted)}>{unit}</small> : null}
        </span>
        <span className={cn("flex min-w-[6.5rem] flex-1 flex-col justify-center gap-1 border-l-2 pl-3", skin.rule)}>
          <span className={cn("text-2xs font-bold uppercase tracking-caps", skin.label)}>{label}</span>
          {status ? (
            <span data-testid="kpi-status" className="flex items-center gap-1.5 text-xs font-semibold">
              <span
                data-testid={hot ? "kpi-ball-dot" : undefined}
                aria-hidden="true"
                className={cn("h-1.5 w-1.5 flex-none rounded-full", hot ? "bg-ball" : "bg-current")}
              />
              {status}
            </span>
          ) : null}
        </span>
      </div>

      {visual ? (
        <div
          className={cn(
            "flex flex-wrap gap-3",
            visualPlacement === "side" ? "items-center justify-between" : "flex-col",
          )}
        >
          {/* The picture is drawn for a light surface, so on a solid tile it
              keeps its own paper inset instead of being redrawn. */}
          <div
            className={cn(
              visualPlacement === "side" ? "w-28 flex-none" : "w-full",
              solid && "rounded-ctl border-2 border-edge bg-paper p-2 text-ink",
            )}
          >
            {visual}
          </div>
        </div>
      ) : null}

      {href ? (
        <Link
          href={href}
          className={cn(
            "touch-target-row inline-flex items-center gap-1.5 text-xs font-bold underline-offset-2 hover:underline",
            skin.label === "text-white/70" ? "text-white" : skin.label,
            captionClassName,
          )}
        >
          {caption}
          <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        </Link>
      ) : (
        <span className={cn("text-xs", skin.muted)}>{caption}</span>
      )}
    </div>
  );
}
