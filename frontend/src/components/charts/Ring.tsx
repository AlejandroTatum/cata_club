/**
 * Ring — a proportion drawn as a ring: the part over the whole, with the
 * figure in the middle.
 *
 * `StatTrack`'s round sibling for tiles that have room for a square. Purely
 * informative, so the whole drawing is one `role="img"` whose name states the
 * figures; the percentage inside is the same fact and stays out of the tree.
 */

import type { ReactElement } from "react";
import { cn } from "@/components/ui";
import { TONE_FILL, percentOf, type ChartTone } from "./chart-utils";

export interface RingProps {
  value: number;
  total: number;
  /** What the ring measures, e.g. "Membresías activas". */
  label: string;
  tone?: ChartTone;
  /** Pixel size of the square. Defaults to 56. */
  size?: number;
  className?: string;
}

const STROKE = 7;

export default function Ring({
  value,
  total,
  label,
  tone = "coal",
  size = 56,
  className,
}: RingProps): ReactElement {
  const share = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = percentOf(value, total);
  const centre = size / 2;

  return (
    <svg
      role="img"
      aria-label={`${label}: ${value} de ${total} (${percent}%)`}
      data-testid="ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("flex-none", className)}
    >
      <circle cx={centre} cy={centre} r={radius} fill="none" strokeWidth={STROKE} className="stroke-line" />
      {share > 0 && (
        <circle
          data-testid="ring-arc"
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${share * circumference} ${circumference}`}
          transform={`rotate(-90 ${centre} ${centre})`}
          className={cn(
            TONE_FILL[tone].replace("fill-", "stroke-"),
            "motion-safe:transition-[stroke-dasharray] motion-safe:duration-300",
          )}
        />
      )}
      <text
        x={centre}
        y={centre}
        textAnchor="middle"
        dominantBaseline="central"
        aria-hidden="true"
        className="fill-ink text-xs font-bold tabular-nums"
      >
        {percent}%
      </text>
    </svg>
  );
}
