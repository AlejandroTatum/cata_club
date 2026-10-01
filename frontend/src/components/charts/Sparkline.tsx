/**
 * Sparkline — a tile-sized trend line for a metric that moves over time.
 *
 * `Bars` counts periods; this one shows the shape of a reading taken every few
 * minutes (requests, CPU, memory), where 60 columns would be noise. The
 * drawing is an `aria-hidden` SVG (`preserveAspectRatio="none"`, so it fills
 * the width the card gives it); the wrapper is a single `role="img"` named by
 * one sentence — minimum, maximum and last — so the figure is never
 * picture-only.
 *
 * Reading a point is available to every input: the pointer moves the tooltip
 * along the line, and the wrapper is one tab stop whose arrow keys (Home / End
 * included) walk the points. 60 focusable columns would be 60 tab stops, which
 * is why this chart has one stop where `Bars` has one per column.
 *
 * An optional `threshold` draws a dashed reference line (the "warn above this"
 * mark) and is included in the scale, so a series that stays under it still
 * shows how far under.
 */

"use client";

import { useState, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { cn } from "@/components/ui";
import ChartTooltip from "./ChartTooltip";
import { TONE_BG, TONE_FILL, type ChartTone } from "./chart-utils";

export interface SparklineProps {
  values: readonly number[];
  /** What is measured, e.g. "Solicitudes por minuto". Starts the accessible name. */
  label: string;
  tone?: ChartTone;
  /** Appended to every figure, e.g. "%" or "MB". */
  unit?: string;
  /** Reference line, e.g. the value above which the reading is a warning. */
  threshold?: number;
  formatValue?: (value: number) => string;
  /** One caption per value for the tooltip ("hace 5 min"); falls back to "Punto N". */
  pointLabels?: readonly string[];
  /** Plot height utility, e.g. "h-10". */
  heightClass?: string;
  className?: string;
}

const TONE_STROKE: Record<ChartTone, string> = {
  coal: "stroke-coal",
  ok: "stroke-state-ok",
  warn: "stroke-state-warn",
  bad: "stroke-state-bad",
  neutral: "stroke-state-neutral",
  muted: "stroke-line-2",
};

const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 40;
/** Keeps the stroke from being clipped at the top and bottom edge. */
const PAD = 3;

export default function Sparkline({
  values,
  label,
  tone = "coal",
  unit,
  threshold,
  formatValue = String,
  pointLabels,
  heightClass = "h-10",
  className,
}: SparklineProps): ReactElement {
  const [active, setActive] = useState<number | null>(null);
  const last = values.length - 1;
  const withUnit = (value: number): string => (unit ? `${formatValue(value)} ${unit}` : formatValue(value));

  const low = Math.min(...values, ...(threshold === undefined ? [] : [threshold]));
  const high = Math.max(...values, ...(threshold === undefined ? [] : [threshold]));
  const span = high - low;
  const xOf = (index: number): number => (last > 0 ? (index / last) * VIEW_WIDTH : VIEW_WIDTH / 2);
  const yOf = (value: number): number =>
    span > 0 ? PAD + (1 - (value - low) / span) * (VIEW_HEIGHT - PAD * 2) : VIEW_HEIGHT / 2;

  const points = values.map((value, index) => `${xOf(index).toFixed(2)},${yOf(value).toFixed(2)}`);
  const area = values.length > 1 ? `0,${VIEW_HEIGHT} ${points.join(" ")} ${VIEW_WIDTH},${VIEW_HEIGHT}` : "";

  const summary =
    values.length === 0
      ? `${label}: sin datos`
      : `${label}: mínimo ${withUnit(Math.min(...values))}, máximo ${withUnit(Math.max(...values))}, último ${withUnit(values[last])}` +
        (threshold === undefined ? "" : `, umbral ${withUnit(threshold)}`);

  const sentence = (index: number): string => `${pointLabels?.[index] ?? `Punto ${index + 1}`}: ${withUnit(values[index])}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (values.length === 0) return;
    const from = active ?? last;
    const next =
      event.key === "ArrowLeft" ? from - 1
      : event.key === "ArrowRight" ? from + 1
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  };

  const onMouseMove = (event: MouseEvent<HTMLDivElement>): void => {
    if (values.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const share = (event.clientX - box.left) / box.width;
    setActive(Math.min(last, Math.max(0, Math.round(share * last))));
  };

  return (
    <div
      role="img"
      aria-label={summary}
      tabIndex={0}
      data-testid="sparkline"
      className={cn("relative rounded-md", heightClass, className)}
      onFocus={() => values.length > 0 && setActive(last)}
      onBlur={() => setActive(null)}
      onKeyDown={onKeyDown}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setActive(null)}
    >
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        {threshold !== undefined && values.length > 0 && (
          <line
            data-testid="sparkline-threshold"
            x1="0"
            x2={VIEW_WIDTH}
            y1={yOf(threshold)}
            y2={yOf(threshold)}
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            className="stroke-ink-3"
          />
        )}
        {area && <polygon data-testid="sparkline-area" points={area} opacity={0.14} className={TONE_FILL[tone]} />}
        {points.length > 0 && (
          <polyline
            data-testid="sparkline-line"
            points={points.join(" ")}
            fill="none"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={TONE_STROKE[tone]}
          />
        )}
      </svg>

      {active !== null && values[active] !== undefined && (
        <>
          <span
            aria-hidden="true"
            data-testid="sparkline-marker"
            className={cn("pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full", TONE_BG[tone])}
            style={{ left: `${xOf(active)}%`, top: `${(yOf(values[active]) / VIEW_HEIGHT) * 100}%` }}
          />
          <ChartTooltip left={`${Math.min(82, Math.max(18, xOf(active)))}%`} className="-top-8">
            {sentence(active)}
          </ChartTooltip>
        </>
      )}
    </div>
  );
}
