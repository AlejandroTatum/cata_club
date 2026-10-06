/**
 * Club-wide no-class days (issue #1665): small pure helpers shared by the admin
 * screen, the member panel and the attendance estimate.
 *
 * A no-class day is a date range, `fechaFin` inclusive, that applies to the
 * whole club. Dates are `YYYY-MM-DD` strings, so comparing them as strings is
 * the same as comparing them as calendar days — no `Date`, no time zone.
 */
import { formatDate } from "@/lib/format-utils";

/** The shape these helpers need; `DiaSinClase` from the API client satisfies it. */
export interface NoClassRange {
  fechaInicio: string;
  fechaFin: string;
}

/** `"04/07/2029"` for a single day, `"04/07/2029 – 06/07/2029"` for a range. */
export function formatNoClassRange(day: NoClassRange): string {
  if (day.fechaInicio === day.fechaFin) return formatDate(day.fechaInicio);
  return `${formatDate(day.fechaInicio)} – ${formatDate(day.fechaFin)}`;
}

/** Whether `fecha` falls inside any of the ranges. */
export function isNoClassDate(fecha: string, days: readonly NoClassRange[]): boolean {
  return days.some((day) => fecha >= day.fechaInicio && fecha <= day.fechaFin);
}

/** Days that have not ended yet as of `hoy` (a day ending today still counts), soonest first. */
export function upcomingNoClassDays<T extends NoClassRange>(days: readonly T[], hoy: string): T[] {
  return days
    .filter((day) => day.fechaFin >= hoy)
    .sort((a, b) => (a.fechaInicio < b.fechaInicio ? -1 : a.fechaInicio > b.fechaInicio ? 1 : 0));
}
