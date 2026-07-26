/**
 * The club's calendar — one answer to "what day is it", for the whole app.
 *
 * Every schedule, attendance record and payment period the backend stores is a
 * bare date or a wall-clock time with no offset attached. "Which day" is
 * therefore a question about the CLUB, never about whoever is reading the
 * screen. The app being used only in Ecuador constrains where people stand,
 * not how their devices are configured — and the BFF routes here run on a
 * server that is almost certainly UTC.
 *
 * ## Two different things, deliberately named apart
 *
 * This is the distinction whose absence let the logic drift into five private
 * copies, each subtly different:
 *
 *   - An INSTANT (`new Date()`) is a point in time. Which calendar date it
 *     falls on depends entirely on the zone you ask from. Use `clubIsoDate`.
 *   - A CALENDAR DATE materialized as a `Date` (`new Date("2026-07-01T12:00:00")`,
 *     or `new Date(y, m, d)`) already IS a day; its clock components are just
 *     an anchor. Converting it through a zone SHIFTS it. Use `calendarIsoDate`.
 *
 * Passing one to the other's function is off-by-one-day, and it only shows up
 * on devices far enough from Ecuador — which is to say, never on the machine
 * of whoever wrote it. The names are long on purpose.
 */

import type { DiaSemana } from "@/types/domain";

/**
 * The club's operating time zone.
 *
 * An IANA zone, not the `-05:00` offset it currently resolves to: Ecuador's
 * mainland has no DST today, and hardcoding the number would survive exactly
 * until that stops being true and then drift by an hour with no error.
 */
export const CLUB_TIME_ZONE = "America/Guayaquil";

/** The date-range presets every filter panel in the app offers. */
export type DateRangePreset = "today" | "this_week" | "this_month" | "custom";

/** A resolved range in `YYYY-MM-DD` form, as the API expects it. */
export interface DateRange {
  fechaInicio: string;
  fechaFin: string;
}

/**
 * Built once and reused: callers resolve dates on every render, and
 * constructing the formatter is the expensive part.
 */
let clubDateFormatter: Intl.DateTimeFormat | null = null;
let clubWeekdayFormatter: Intl.DateTimeFormat | null = null;

/**
 * `YYYY-MM-DD` from a `Date`'s LOCAL components.
 *
 * For values that already represent a calendar date — the result of date
 * arithmetic, or a bare ISO date parsed at local noon. Reading these back in
 * local components returns the same day that was written in; routing them
 * through a time zone would shift them.
 *
 * NOT for `new Date()`. That is an instant — use `clubIsoDate`.
 */
export function calendarIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The calendar date at the club for a given INSTANT, as `YYYY-MM-DD`.
 *
 * This is the one to reach for when stamping "today" onto anything: an
 * attendance record, a payment start date, the end of a filter range.
 *
 * Assembled from `formatToParts` rather than a locale format string, so no
 * locale's date order or numbering system can reshape the output.
 */
export function clubIsoDate(instant: Date = new Date()): string {
  try {
    clubDateFormatter ??= new Intl.DateTimeFormat("en-US", {
      timeZone: CLUB_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = clubDateFormatter.formatToParts(instant);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (!year || !month || !day) return calendarIsoDate(instant);
    return `${year}-${month}-${day}`;
  } catch {
    // Degrades to the device's reading rather than throwing inside a render
    // or a request handler — a date off by a day is recoverable, a 500 is
    // not.
    return calendarIsoDate(instant);
  }
}

/**
 * The club's current calendar date, as a `Date` anchored at LOCAL noon.
 *
 * The bridge between the two worlds above: give it an instant, get back a
 * calendar date you can do day arithmetic on and read with `calendarIsoDate`.
 *
 * Noon, not midnight: a midnight anchor can slip to the previous day across a
 * DST boundary in whatever zone the device runs in. Noon leaves 12 hours of
 * slack either way. This mirrors the anchoring `format-utils` already uses
 * when it parses a bare ISO date.
 */
export function clubToday(now: Date = new Date()): Date {
  return new Date(`${clubIsoDate(now)}T12:00:00`);
}

const EN_WEEKDAY_TO_DIA_SEMANA: Record<string, DiaSemana> = {
  Sun: "dom",
  Mon: "lun",
  Tue: "mar",
  Wed: "mie",
  Thu: "jue",
  Fri: "vie",
  Sat: "sab",
};

const JS_DAY_INDEX_TO_DIA_SEMANA: DiaSemana[] = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

/**
 * Today's `DiaSemana` as the club experiences it.
 *
 * Prefer this over `new Date().getDay()` anywhere a schedule is matched to a
 * day — see the module header for why the device's answer is the wrong one.
 */
export function todayDiaSemana(now: Date = new Date()): DiaSemana {
  try {
    clubWeekdayFormatter ??= new Intl.DateTimeFormat("en-US", {
      timeZone: CLUB_TIME_ZONE,
      weekday: "short",
    });
    const weekday = clubWeekdayFormatter.format(now);
    return EN_WEEKDAY_TO_DIA_SEMANA[weekday] ?? JS_DAY_INDEX_TO_DIA_SEMANA[now.getDay()] ?? "lun";
  } catch {
    return JS_DAY_INDEX_TO_DIA_SEMANA[now.getDay()] ?? "lun";
  }
}

/**
 * Resolve a preset into `{ fechaInicio, fechaFin }`, both `YYYY-MM-DD`.
 *
 * `custom` returns empty strings — the caller owns those two pickers.
 *
 * The week starts on MONDAY. `Date.getDay()` numbers Sunday as 0, and letting
 * that leak in made "Esta semana" disagree with every other day list in the
 * app (`DIA_SEMANA_LABELS` and `groupSchedulesByDay` both run lun..dom) and
 * with how the club itself reads a week. On a Sunday the old rule also reset
 * the range to a single day, blanking a trainer's week at the exact moment
 * they were reviewing it.
 */
export function buildDateRange(preset: DateRangePreset, now: Date = new Date()): DateRange {
  if (preset === "custom") return { fechaInicio: "", fechaFin: "" };

  const today = clubToday(now);
  const todayIso = calendarIsoDate(today);

  switch (preset) {
    case "today":
      return { fechaInicio: todayIso, fechaFin: todayIso };
    case "this_week": {
      // Monday = 0 .. Sunday = 6.
      const daysSinceMonday = (today.getDay() + 6) % 7;
      const start = new Date(today);
      start.setDate(today.getDate() - daysSinceMonday);
      return { fechaInicio: calendarIsoDate(start), fechaFin: todayIso };
    }
    case "this_month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1, 12);
      return { fechaInicio: calendarIsoDate(start), fechaFin: todayIso };
    }
  }
}
