/**
 * LevelChip — the rank chip for the training ladder.
 *
 * `_sistema.css` `.lv` (:282): 28px square, 8px radius, 12px/800 centered.
 * The fill comes from the `--l1`…`--l10` sequential grey ramp (:44-45), and
 * `13-niveles.html:84-93` pins the foreground for every rung: l1 is the only
 * one that wears `--ball`, l2–l7 are white, l8–l10 are `--ink`.
 *
 * Product rules baked in: level 1 is the TOP of the ladder and 10 the base —
 * the ramp gets darker as you climb. The chip carries rank and nothing else:
 * no occupancy meter, no minimum-headcount warning, no "N/M" fraction.
 */

import type { ReactElement } from "react";
import { cn } from "./cn";

/** Valid rungs. 1 is the top of the ladder, 10 the base. */
export const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type Level = (typeof LEVELS)[number];

/** Background per rung — the `--l1`…`--l10` ramp. */
const LEVEL_BG: Record<Level, string> = {
  1: "bg-l1",
  2: "bg-l2",
  3: "bg-l3",
  4: "bg-l4",
  5: "bg-l5",
  6: "bg-l6",
  7: "bg-l7",
  8: "bg-l8",
  9: "bg-l9",
  10: "bg-l10",
};

/** Foreground per rung, transcribed from `13-niveles.html`. */
const LEVEL_FG: Record<Level, string> = {
  1: "text-ball",
  2: "text-white",
  3: "text-white",
  4: "text-white",
  5: "text-white",
  6: "text-white",
  7: "text-white",
  8: "text-ink",
  9: "text-ink",
  10: "text-ink",
};

export function isLevel(value: number): value is Level {
  return Number.isInteger(value) && value >= 1 && value <= 10;
}

export interface LevelChipProps {
  level: Level;
  /** Accessible name. Defaults to "Nivel {level}". */
  label?: string;
  className?: string;
}

export default function LevelChip({
  level,
  label,
  className,
}: LevelChipProps): ReactElement {
  return (
    <span
      title={label ?? `Nivel ${level}`}
      className={cn(
        "flex h-7 w-7 flex-none items-center justify-center rounded-lg text-xs font-extrabold",
        LEVEL_BG[level],
        LEVEL_FG[level],
        className,
      )}
    >
      <span className="sr-only">{label ?? `Nivel ${level}`}</span>
      <span aria-hidden="true">{level}</span>
    </span>
  );
}
