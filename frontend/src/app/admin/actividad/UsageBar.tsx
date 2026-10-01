/**
 * UsageBar — how much of a limit is used, as a labelled meter.
 *
 * `StatTrack` draws a proportion in coal and hides it from assistive tech,
 * which is right when a tile states both figures right above it. Here the
 * bar's colour is the warning (a container near its memory limit), so it takes
 * a tone and exposes itself as a `meter` whose name carries the figures.
 */

import type { ReactElement } from "react";
import { cn } from "@/components/ui";
import { shareOf } from "./activity-utils";
import type { Tone } from "./actividad-types";

const FILL: Record<Tone, string> = {
  ok: "bg-coal",
  warn: "bg-state-warn",
  bad: "bg-state-bad",
};

export interface UsageBarProps {
  /** Accessible name with the figures, e.g. "backend: 262 MB de 320 MB (82%)". */
  label: string;
  used: number;
  limit: number;
  tone: Tone;
  className?: string;
}

export default function UsageBar({ label, used, limit, tone, className }: UsageBarProps): ReactElement {
  const percent = Math.min(100, shareOf(used, limit));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(used, limit)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}
    >
      <i className={cn("block h-full rounded-full", FILL[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}
