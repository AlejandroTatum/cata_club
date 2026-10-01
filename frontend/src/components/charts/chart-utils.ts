/**
 * Shared bits of the small dashboard charts.
 *
 * The charts draw with the same state tokens the badges use, so a colour means
 * the same thing on a bar as on a pill. A series that needs a hue the tokens
 * do not have (the attendance palette) passes its own `color` instead.
 */

import { useCallback, useState } from "react";

export type ChartTone = "coal" | "ok" | "warn" | "bad" | "neutral" | "muted";

/** SVG fill classes, one per tone. */
export const TONE_FILL: Record<ChartTone, string> = {
  coal: "fill-coal",
  ok: "fill-state-ok",
  warn: "fill-state-warn",
  bad: "fill-state-bad",
  neutral: "fill-state-neutral",
  muted: "fill-line-2",
};

/** HTML background classes, one per tone (legend dots, segments, blocks). */
export const TONE_BG: Record<ChartTone, string> = {
  coal: "bg-coal",
  ok: "bg-state-ok",
  warn: "bg-state-warn",
  bad: "bg-state-bad",
  neutral: "bg-state-neutral",
  muted: "bg-line-2",
};

/** Minimal shape every multi-series chart shares. */
export interface ChartSeries {
  key: string;
  label: string;
  tone?: ChartTone;
  /** Any CSS colour; wins over `tone`. */
  color?: string;
}

/** Inline colour for a series, or `undefined` when its tone class does the job. */
export function seriesStyle(series: ChartSeries): { fill?: string; backgroundColor?: string } | undefined {
  return series.color ? { fill: series.color, backgroundColor: series.color } : undefined;
}

export interface ActiveHandlers {
  active: number | null;
  show: (index: number) => void;
  hide: (index: number) => void;
}

/**
 * Which part of a chart is being read. Hover and keyboard focus feed the same
 * state, so the tooltip that appears under a pointer is the one a keyboard
 * user gets on Tab.
 */
export function useActiveIndex(): ActiveHandlers {
  const [active, setActive] = useState<number | null>(null);
  const show = useCallback((index: number) => setActive(index), []);
  const hide = useCallback((index: number) => setActive((current) => (current === index ? null : current)), []);
  return { active, show, hide };
}

/** Keeps a tooltip centred on its column without running off the plot. */
export function tooltipLeft(index: number, count: number): string {
  const centre = ((index + 0.5) / Math.max(count, 1)) * 100;
  return `${Math.min(82, Math.max(18, centre))}%`;
}

/** "65%" style rounding shared by the charts' read-outs. */
export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
