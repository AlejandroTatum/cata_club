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

export interface StatTrackProps {
  /** The part. */
  value: number;
  /** The whole it is measured against. */
  total: number;
  className?: string;
}

/**
 * StatTrack — a proportion drawn as a proportion.
 *
 * D7's second rule: "la figura toma la forma de lo que mide: una proporción
 * lleva barra". `_sistema.css` `.track` (:319-320) already declares that bar —
 * a 6px rail at the pill radius in `--line`, carrying an `<i>` fill in
 * `--coal` — and `06-panel.html:86` is the tile that spends it, on this very
 * statistic: `<span class="v">17<small>de 44</small></span><span class="track">
 * <i style="width:39%"></i></span>`.
 *
 * ## Why it takes two numbers and not a percentage
 *
 * The share is arithmetic on figures the screen already holds, and doing that
 * arithmetic at each call site is how a bar comes to disagree with the count
 * printed above it. Handing it the part and the whole also lets the ONE honest
 * answer for `total === 0` live here: an empty rail, not `NaN%` and not a full
 * one. The clamp is the same argument — a numerator larger than its whole is a
 * data problem, and a bar drawn past its own rail turns it into a rendering
 * problem as well.
 *
 * ## Why it says nothing to a screen reader
 *
 * The tile states both figures in text right above it. A `role="meter"` here
 * would make the same fact arrive twice, the second time as a number nobody
 * asked for — the same reason `IdentityCell` hides the initials that repeat the
 * name beside them.
 *
 * ## Why every element is phrasing content
 *
 * `StatCard` wraps its `hint` in a `<span>`. A `<div>` in there is invalid
 * markup that the parser repairs by splitting the surrounding span, which
 * takes the tile's layout with it. `<span>` and `<i>` — the spec's own
 * element — nest legally.
 */
export function StatTrack({ value, total, className }: StatTrackProps): ReactElement {
  const share = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  // One decimal: enough that 21/69 and 22/69 are visibly different bars,
  // short enough that the emitted style stays readable in a diff.
  const percent = Math.round(share * 1000) / 10;

  return (
    <span
      aria-hidden="true"
      data-testid="stat-track"
      className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-line", className)}
    >
      <i className="block h-full rounded-full bg-coal" style={{ width: `${percent}%` }} />
    </span>
  );
}

export interface StatSparkProps {
  /** One figure per period, oldest first. */
  values: readonly number[];
  className?: string;
}

/**
 * StatSpark — a series drawn as a series.
 *
 * `StatTrack`'s sibling, and the other half of D7's rule of shape: "una
 * proporción lleva barra, una serie lleva tendencia". The bar answers "how much
 * of the whole"; this answers "which way is it going", and a single aggregate
 * answers neither.
 *
 * It exists because `/dashboard` was already computing one.
 * `buildFourWeekAttendance` returns four windows, each with its own total,
 * present count and rate — and the screen rendered only the pooled percentage
 * and dropped `bars` on the floor. So 52% could be four flat weeks or a
 * collapse from 70 to 30, and the tile read identically either way. Nothing is
 * invented here: every bar is a window the page already holds.
 *
 * ## Why it scales against the tallest period and not against 100
 *
 * The figures this draws are attendance rates that live in a band — 48 to 70,
 * not 5 to 95. Against a fixed 100 ceiling those four become four bars of
 * nearly equal height, which is a trend drawn so faithfully that it is
 * unreadable. Scaling to the series' own maximum is what makes the shape carry
 * the comparison, and the tile still prints the absolute figure above it, so
 * the number nobody can misread is the one stated in words.
 *
 * ## Why a zero period is a stub and not an absent bar
 *
 * A week with no sessions and a week that is missing are different facts. Drop
 * the bar and the reader counts three periods; draw 2px and they count four,
 * one of which is empty. The same argument `StatTrack` makes for an empty rail
 * over `NaN%`.
 *
 * ## Why an empty series renders nothing
 *
 * "Don't inventar un dato para completar una forma." No periods means there is
 * no trend to draw, and an empty rail is a shape claiming to hold one. The
 * caller gets `null` and its tile stays quiet.
 *
 * Phrasing content and `aria-hidden`, for the two reasons `StatTrack` states.
 */
export function StatSpark({ values, className }: StatSparkProps): ReactElement | null {
  if (values.length === 0) return null;

  const ceiling = Math.max(...values, 0);
  const last = values.length - 1;

  return (
    <span
      aria-hidden="true"
      data-testid="stat-spark"
      className={cn("flex h-4 w-full items-end gap-[3px]", className)}
    >
      {values.map((value, index) => {
        const share = ceiling > 0 ? Math.max(0, value) / ceiling : 0;
        return (
          <i
            key={index}
            className={cn(
              "block flex-1 rounded-[2px]",
              // The newest period is the one the figure above reports; the
              // earlier ones are the context it is being read against.
              index === last ? "bg-coal" : "bg-line-2",
            )}
            style={{ height: share > 0 ? `${Math.round(share * 1000) / 10}%` : "2px" }}
          />
        );
      })}
    </span>
  );
}

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

      {/* DESIGN.md's `stat` step: Graduate at 32px, in tabular figures. Case
          never arises — digits have one — so the display family buys the
          scoreboard figure the system is named after and costs nothing in
          legibility. It does cost the weight: Graduate ships a single 400 cut
          (`lib/fonts.ts`), so the `font-extrabold` this line used to carry was a
          request for a bold the face cannot draw. `tracking-flat` cancels the
          -0.04em `text-2xl` carries for Barlow; Graduate's digits are already
          wide and flat, and tightening them runs them together. */}
      <span
        className={cn(
          "font-display text-2xl leading-none tabular-nums tracking-flat",
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
