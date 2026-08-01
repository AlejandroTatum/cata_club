/**
 * StatCard — the 116px fixed-height pulse tile.
 *
 * `_sistema.css` `.stat` (:216-220): `--h-stat` 116px, `--r-card` 14px radius,
 * `--paper` surface on a `--line` border, 16px/18px padding, label
 * 10.5px/700/.1em uppercase in `--ink-3`, value 32px/800/-.04em tabular in
 * `--ink`, `small` unit 14px/600 in `--ink-3`, hint 12px in `--ink-3`.
 *
 * Non-negotiable: the number is ALWAYS ink. Color lives in badges and pills,
 * never in a stat value — a green "17" is a defect, not a nicety.
 *
 * The `hot` variant inverts the tile onto coal for the one priority stat per
 * screen. `_sistema.css` has no `.stat.hot` rule, so its colors are taken from
 * the two coal stat surfaces the spec DOES define: `.hero` (:228-233 — `--coal`
 * fill, #FFF figure, `rgba(255,255,255,.6)` sub-line preceded by a 6px `--ball`
 * dot) and `.lp-facts` (:454-457 — `rgba(255,255,255,.45)` uppercase label).
 * White-on-coal is the spec's own treatment for a figure on coal; it is not a
 * colored number.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

/**
 * The stat row itself, not the tile: the grid every screen that draws four
 * pulse tiles reaches for.
 *
 * `_sistema.css` `.stats` (:222) is `display: grid; gap: 14px` with `.c2` and
 * `.c4` as column modifiers, so the gutter is a property of the ROW and the
 * column count is the variation on top. `gap-section` IS that 14px — the
 * vertical rhythm's middle step, which is the card radius.
 *
 * It carries no margin: the distance to the next block belongs to the page
 * rhythm on `<main>`. See `docs/ux/ritmo-vertical.md`.
 */
export const STAT_GRID = "grid gap-section sm:grid-cols-2 lg:grid-cols-4";

export type StatCardVariant = "default" | "hot";

export interface StatCardProps {
  /** Uppercase key, e.g. "Membresías activas". */
  label: string;
  /** The figure. Kept as a node so callers can pass a formatted string. */
  value: ReactNode;
  /** Small trailing unit rendered inside the figure, e.g. "de 44" or "%". */
  unit?: string;
  /** Bottom line — a short qualifier, a link, or a sparkline/track element. */
  hint?: ReactNode;
  variant?: StatCardVariant;
  className?: string;
}

export default function StatCard({
  label,
  value,
  unit,
  hint,
  variant = "default",
  className,
}: StatCardProps): ReactElement {
  const hot = variant === "hot";

  return (
    <div
      className={cn(
        "h-stat rounded-card border px-[18px] py-4 flex flex-col justify-between",
        hot ? "bg-coal border-coal" : "bg-paper border-line",
        className,
      )}
    >
      <span
        className={cn(
          "text-2xs font-bold uppercase",
          hot ? "text-white/45" : "text-ink-3",
        )}
      >
        {label}
      </span>

      <span
        className={cn(
          "text-2xl font-extrabold leading-none tabular-nums",
          hot ? "text-white" : "text-ink",
        )}
      >
        {value}
        {unit ? (
          <small
            className={cn(
              "ml-[3px] text-sm font-semibold",
              hot ? "text-white/60" : "text-ink-3",
            )}
          >
            {unit}
          </small>
        ) : null}
      </span>

      {hint ? (
        <span
          className={cn(
            "text-xs",
            hot ? "flex items-center gap-2 text-white/60" : "text-ink-3",
          )}
        >
          {hot ? (
            <span
              data-testid="statcard-ball-dot"
              aria-hidden="true"
              className="h-1.5 w-1.5 flex-none rounded-full bg-ball"
            />
          ) : null}
          {hint}
        </span>
      ) : null}
    </div>
  );
}
