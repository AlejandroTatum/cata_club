/**
 * Bars — a short series drawn as columns, one per period.
 *
 * The drawing is an `aria-hidden` SVG; on top of it sits one focusable hit
 * target per column whose accessible name is the sentence the tooltip shows
 * ("Semana del 14/09: 65% · 13 de 20"). Hover and focus open the same tooltip,
 * so the figure is never pointer-only. The wrapper is a named group holding the
 * summary, and the columns are the items inside it.
 *
 * Columns scale against `max` (the series' own tallest value unless a fixed
 * ceiling is given — pass 100 for percentages). A zero is a 2-unit stub, not an
 * absent bar, so "no sessions that week" is still a column the reader can count.
 * Motion is limited to a height transition guarded by `motion-safe`.
 */

"use client";

import type { ReactElement } from "react";
import { cn } from "@/components/ui";
import ChartTooltip from "./ChartTooltip";
import { TONE_FILL, tooltipLeft, useActiveIndex, type ChartTone } from "./chart-utils";

export interface BarDatum {
  key: string;
  /** Short axis label under the column, e.g. "14/09". */
  label: string;
  value: number;
  /** The sentence for the tooltip and the accessible name. */
  detail: string;
}

export interface BarsProps {
  data: readonly BarDatum[];
  /** One-line summary of the whole chart, read before the columns. */
  ariaLabel: string;
  /** Fixed ceiling (100 for percentages); defaults to the tallest value. */
  max?: number;
  tone?: ChartTone;
  /** Draw the newest column in full tone and the rest muted. Default true. */
  highlightLast?: boolean;
  /** Plot height utility, e.g. "h-24". */
  heightClass?: string;
  /** Hide the axis labels (a tile-sized sparkline has no room for them). */
  hideLabels?: boolean;
  className?: string;
}

const VIEW_HEIGHT = 100;

export default function Bars({
  data,
  ariaLabel,
  max,
  tone = "coal",
  highlightLast = true,
  heightClass = "h-24",
  hideLabels = false,
  className,
}: BarsProps): ReactElement {
  const { active, show, hide } = useActiveIndex();
  const ceiling = max ?? Math.max(...data.map((d) => d.value), 0);
  const slot = 100 / Math.max(data.length, 1);
  const last = data.length - 1;

  return (
    <div role="group" aria-label={ariaLabel} data-testid="bars" className={cn("flex flex-col gap-1.5", className)}>
      <div className={cn("relative", heightClass)}>
        <svg
          aria-hidden="true"
          viewBox={`0 0 100 ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <line x1="0" x2="100" y1={VIEW_HEIGHT} y2={VIEW_HEIGHT} strokeWidth="1" vectorEffect="non-scaling-stroke" className="stroke-line-2" />
          {data.map((datum, index) => {
            const share = ceiling > 0 ? Math.min(1, Math.max(0, datum.value) / ceiling) : 0;
            const height = share > 0 ? Math.max(share * VIEW_HEIGHT, 3) : 2;
            const current = !highlightLast || index === last || active === index;
            return (
              <rect
                key={datum.key}
                x={index * slot + slot * 0.18}
                width={slot * 0.64}
                y={VIEW_HEIGHT - height}
                height={height}
                className={cn(
                  current ? TONE_FILL[tone] : TONE_FILL.muted,
                  "motion-safe:transition-[height,y] motion-safe:duration-300",
                )}
              />
            );
          })}
        </svg>

        <div className="absolute inset-0 flex">
          {data.map((datum, index) => (
            <span
              key={datum.key}
              role="img"
              tabIndex={0}
              aria-label={datum.detail}
              data-testid="bars-column"
              className="flex-1 rounded-md"
              onMouseEnter={() => show(index)}
              onMouseLeave={() => hide(index)}
              onFocus={() => show(index)}
              onBlur={() => hide(index)}
            />
          ))}
        </div>

        {active !== null && data[active] && (
          <ChartTooltip left={tooltipLeft(active, data.length)}>{data[active].detail}</ChartTooltip>
        )}
      </div>

      {!hideLabels && (
        <div aria-hidden="true" className="flex text-2xs tabular-nums text-ink-3-strong">
          {data.map((datum) => (
            <span key={datum.key} className="flex-1 text-center">
              {datum.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
