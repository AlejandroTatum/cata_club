/**
 * Numeric age spans for the landing's schedule cards. The backend publishes
 * only the club's orientation label ("5 a 10 años", "Mayores de 12 años",
 * "Selección"), so the spans are read from that text. They drive the age bar
 * only — a visual aid, never a rule: no student's age is validated against it.
 */

/** Age the bar's open end stands for ("18+"). */
const ADULT_AGE = 18;

const CLOSED_RANGE = /(\d{1,2})\s*a\s*(\d{1,2})/i;
const OPEN_RANGE = /(?:mayores?|m[aá]s)\s+de\s+(\d{1,2})/i;

export interface AgeSpan {
  min: number;
  max: number;
  /** The span reaches the end of the scale ("18+"). */
  openEnded: boolean;
}

export interface AgeScale {
  from: number;
  to: number;
  /** Some category has no upper age, so the last cell reads "to+". */
  plus: boolean;
}

/**
 * "Mayores de N" starts at N + 1 (capped at 18, where adults begin) and stops
 * one year before the next open-ended category starts; the last one runs to
 * the end of the scale. A label with no numbers, like "Selección", has none.
 */
export function resolveAgeSpans(audiences: Array<string | undefined>): Array<AgeSpan | null> {
  const parsed = audiences.map((audience): { min: number; max: number | null } | null => {
    const text = audience ?? "";
    const closed = CLOSED_RANGE.exec(text);
    if (closed !== null) return { min: Number.parseInt(closed[1], 10), max: Number.parseInt(closed[2], 10) };
    const open = OPEN_RANGE.exec(text);
    if (open !== null) return { min: Math.min(Number.parseInt(open[1], 10) + 1, ADULT_AGE), max: null };
    return null;
  });
  const openStarts = parsed.flatMap((range): number[] => (range !== null && range.max === null ? [range.min] : []));

  return parsed.map((range): AgeSpan | null => {
    if (range === null) return null;
    if (range.max !== null) return { min: range.min, max: range.max, openEnded: false };
    const nextStart = Math.min(...openStarts.filter((start): boolean => start > range.min));
    if (Number.isFinite(nextStart)) return { min: range.min, max: nextStart - 1, openEnded: false };
    return { min: range.min, max: Math.max(range.min, ADULT_AGE), openEnded: true };
  });
}

export function ageScale(spans: Array<AgeSpan | null>): AgeScale | null {
  const present = spans.filter((span): span is AgeSpan => span !== null);
  if (present.length === 0) return null;
  return {
    from: Math.min(...present.map((span): number => span.min)),
    to: Math.max(...present.map((span): number => span.max)),
    plus: present.some((span): boolean => span.openEnded),
  };
}

const WEEK_ORDER = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] as const;

/** "Lunes, Martes, Miércoles, Jueves y Viernes" → "Lunes a viernes"; anything else is left alone. */
export function compactDays(days: string): string {
  const present = WEEK_ORDER.flatMap((name, index): number[] => (days.includes(name) ? [index] : []));
  if (present.length < 3) return days;
  const consecutive = present.every((day, index): boolean => index === 0 || day === present[index - 1] + 1);
  if (!consecutive) return days;
  return `${WEEK_ORDER[present[0]]} a ${WEEK_ORDER[present[present.length - 1]].toLowerCase()}`;
}
