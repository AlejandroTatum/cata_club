/**
 * MetricBlock — one reading of the advanced view: its name, the current value,
 * and the line it has drawn over the range.
 *
 * It sits on `sunken` inside its card (an inset area, not a nested card). When
 * the reading is not fine it says so in WORDS in a `Badge` ("Atención",
 * "En aumento", …); the line's colour repeats it, it never carries it alone.
 */

import type { ReactElement, ReactNode } from "react";
import { Badge } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import type { HealthLevel, Series } from "./demo-data";
import { formatPointLabel } from "./activity-utils";

export interface MetricBlockProps {
  label: string;
  /** The current value, already formatted. */
  value: string;
  unit?: string;
  tone: HealthLevel;
  /** Words for the badge when `tone` is not ok. */
  statusLabel?: string;
  series: Series;
  formatValue?: (value: number) => string;
  /** Dashed reference line on the sparkline. */
  threshold?: number;
  /** One line under the figure, e.g. "2,3 GB de 3,8 GB". */
  caption?: ReactNode;
  testId?: string;
}

export default function MetricBlock({
  label,
  value,
  unit,
  tone,
  statusLabel,
  series,
  formatValue,
  threshold,
  caption,
  testId,
}: MetricBlockProps): ReactElement {
  const count = series.values.length;
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-section rounded-card bg-sunken p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-bold uppercase text-ink-3-strong">{label}</span>
        {tone !== "ok" && statusLabel ? <Badge tone={tone}>{statusLabel}</Badge> : null}
      </div>
      <span className="font-display text-2xl leading-none tabular-nums tracking-flat text-ink">
        {value}
        {unit ? <small className="ml-[3px] font-sans text-sm font-semibold text-ink-3-strong">{unit}</small> : null}
      </span>
      <Sparkline
        values={series.values}
        label={label}
        unit={unit}
        tone={tone === "ok" ? "coal" : tone}
        threshold={threshold}
        formatValue={formatValue}
        pointLabels={series.values.map((_, i) => formatPointLabel(i, count, series.stepMinutes))}
      />
      {caption ? <span className="text-xs text-ink-3-strong">{caption}</span> : null}
    </div>
  );
}
