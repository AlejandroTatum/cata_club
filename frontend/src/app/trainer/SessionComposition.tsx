/**
 * How a filed session turned out, drawn once for the whole trainer panel.
 *
 * "Últimas listas" (`RecentSessionsList`) and the history table
 * (`attendance/history/page.tsx`) measure exactly the same thing — the four
 * attendance states of one session — and until this file existed they drew it
 * two different ways: a proportional bar on "Mi día", four loose colored
 * badges in the history. The bar was the deliberate replacement for that badge
 * table, with its reasoning written in `RecentSessionsList`'s own module doc
 * (color is reserved for badges and pills, and four tones per row compete with
 * the page's one red CTA) — the history simply never got the same pass, so the
 * product carried two vocabularies for one number, which is the drift
 * DESIGN.md's last "Don't" names outright.
 *
 * Both pieces are here rather than one combined block because the two callers
 * lay them out differently: the dense row on "Mi día" swaps the bar for the
 * breakdown on hover, and the table cell shows both at once.
 *
 * The bar is decorative on its own — it is a row of colored spans — so it
 * carries `role="img"` and an accessible name that states all four counts and
 * the total. Every number a sighted reader gets from the proportions reaches
 * the accessibility tree as words.
 */

import type { EstadoAsistencia } from "@/types/domain";
import { ATTENDANCE_STATUS_CHART_COLORS } from "@/app/dashboard/dashboard-utils";
import {
  buildSessionBarAriaLabel,
  buildSessionBarSegments,
  formatStateCount,
} from "./trainer-day-utils";

export interface SessionCompositionProps {
  counts: Record<EstadoAsistencia, number>;
  total: number;
  /**
   * Both pieces default to `flex`, and both accept a `hidden`/`max-sm:flex`
   * pair on top: Tailwind emits `hidden` after `flex` in the display group and
   * a media-query variant after both, so the caller's rule wins in each
   * direction. That is how the dense row on "Mi día" swaps one for the other.
   */
  className?: string;
}

/**
 * The proportional bar: one segment per state, in the panel's reading order.
 *
 * `tabIndex` is the caller's call, and only "Mi día" spends it: there the bar
 * is the only thing carrying the four numbers until a pointer hovers the row,
 * so it has to be reachable by keyboard for its accessible name to be
 * readable at all. Where the counts are printed beside it, a tab stop would
 * announce the same figures twice.
 */
export function SessionCompositionBar({
  counts,
  total,
  className = "",
  tabIndex,
}: SessionCompositionProps & { tabIndex?: number }): React.ReactElement {
  const segments = buildSessionBarSegments(counts, total);

  return (
    <span
      role="img"
      tabIndex={tabIndex}
      aria-label={buildSessionBarAriaLabel(counts, total)}
      className={`flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-line ${className}`}
    >
      {segments.map((segment) => (
        <span
          key={segment.estado}
          style={{
            width: `${segment.widthPercent}%`,
            backgroundColor: ATTENDANCE_STATUS_CHART_COLORS[segment.estado],
          }}
        />
      ))}
    </span>
  );
}

/**
 * The same four numbers as text — "2 presentes · 1 tardanza · …" — for the
 * caller that has room to print them beside the bar.
 *
 * The dot repeats the bar's color and is therefore `aria-hidden`; the phrase
 * beside it is what carries the state, so no row here is distinguishable by
 * color alone.
 */
export function SessionCompositionCounts({
  counts,
  total,
  className = "",
}: SessionCompositionProps): React.ReactElement {
  const segments = buildSessionBarSegments(counts, total);

  return (
    <span className={`flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-ink-2 ${className}`}>
      {segments.map((segment) => (
        <span key={segment.estado} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 flex-none rounded-[3px]"
            style={{ backgroundColor: ATTENDANCE_STATUS_CHART_COLORS[segment.estado] }}
          />
          {formatStateCount(segment.estado, segment.count)}
        </span>
      ))}
    </span>
  );
}
