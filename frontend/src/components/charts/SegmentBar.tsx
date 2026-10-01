/**
 * SegmentBar — one horizontal bar split into the parts of a whole.
 *
 * The pipeline of payments (pendientes / validados / rechazados) and the
 * alumnos-versus-staff split are both "one whole, a few states": a single bar
 * says it faster than a donut and takes one line. Every segment is a focusable
 * element whose accessible name carries its label and count; with an `href` it
 * is a link, so a segment is also a way into the list it counts.
 *
 * A legend row under the bar spells the same figures out in text, which is what
 * makes the bar safe to hide from the tree. Segments at 0 keep their legend
 * entry but no width.
 */

"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { cn } from "@/components/ui";
import ChartTooltip from "./ChartTooltip";
import { TONE_BG, percentOf, seriesStyle, tooltipLeft, useActiveIndex, type ChartSeries } from "./chart-utils";

export interface Segment extends ChartSeries {
  value: number;
  /** Where the segment leads; omit for a plain, non-navigating segment. */
  href?: string;
}

export interface SegmentBarProps {
  segments: readonly Segment[];
  /** One-line summary of the whole bar. */
  ariaLabel: string;
  /** Hide the text legend (only when the surrounding tile already states the figures). */
  hideLegend?: boolean;
  className?: string;
}

function describe(segment: Segment, total: number): string {
  return `${segment.label}: ${segment.value} (${percentOf(segment.value, total)}%)`;
}

export default function SegmentBar({
  segments,
  ariaLabel,
  hideLegend = false,
  className,
}: SegmentBarProps): ReactElement {
  const { active, show, hide } = useActiveIndex();
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const drawn = segments.map((segment, index) => ({ segment, index })).filter(({ segment }) => segment.value > 0);

  return (
    <div role="group" aria-label={ariaLabel} data-testid="segment-bar" className={cn("flex flex-col gap-2.5", className)}>
      <div className="relative">
        <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-line">
          {drawn.map(({ segment, index }) => {
            const shared = {
              "aria-label": describe(segment, total),
              "data-testid": "segment",
              style: { width: `${(segment.value / total) * 100}%`, ...seriesStyle(segment) },
              className: cn("block h-full min-w-1.5 motion-safe:transition-opacity", segment.tone ? TONE_BG[segment.tone] : TONE_BG.coal),
              onMouseEnter: () => show(index),
              onMouseLeave: () => hide(index),
              onFocus: () => show(index),
              onBlur: () => hide(index),
            };
            return segment.href ? (
              <Link key={segment.key} href={segment.href} {...shared} />
            ) : (
              <span key={segment.key} role="img" tabIndex={0} {...shared} />
            );
          })}
        </div>
        {active !== null && segments[active] && (
          <ChartTooltip left={tooltipLeft(active, segments.length)} className="-top-9">
            {describe(segments[active], total)}
          </ChartTooltip>
        )}
      </div>

      {!hideLegend && (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-ink-2">
          {segments.map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn("h-2 w-2 flex-none rounded-full", segment.tone ? TONE_BG[segment.tone] : TONE_BG.coal)}
                style={seriesStyle(segment)}
              />
              {segment.label}
              <b className="font-semibold tabular-nums text-ink">{segment.value}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
