/**
 * Pure utility functions for the Reportes admin page.
 *
 * No React dependencies — pure functions for testability. Mirrors the
 * client-side pagination pattern established in members-utils.ts and
 * attendance-utils.ts: each report tab keeps its own page-size constant
 * and paginate/getTotalPages pair since they're independent datasets.
 */

import type { PersonaReporte } from "@/types/domain";
import type { AttendanceRecord } from "@/app/attendance/attendance-utils";
import type { PaymentValidationRequest } from "@/services/api";
import {
  buildDateRange,
  calendarIsoDate,
  clubToday,
  type DateRange,
  type DateRangePreset,
} from "@/lib/club-date";
import { FOUNDING_DATE } from "@/app/landing/landing-config";

// ---------------------------------------------------------------------------
// Quick date-range presets (issue #201)
// ---------------------------------------------------------------------------
//
// The three report tabs used to force "Desde"/"Hasta" to be typed by hand for
// every query, even routine ones like "this month". This adds the two ranges
// `DateRangePreset` (club-date.ts) does not know about — "últimos 3 meses" and
// "histórico completo" — as a report-scoped superset, rather than widening the
// shared attendance-filter type: `buildDateRange`'s switch is exhaustive over
// today/this_week/this_month, and every other caller (AttendanceFilters) only
// ever needs those three plus "custom".

/** Every quick range the reports screen offers, "custom" included. */
export type ReportRangePreset = DateRangePreset | "last_3_months" | "full_history";

/**
 * "Hoy" first, "Personalizado" last — same funnel-then-escape-hatch order as
 * `DATE_PRESETS` in attendance-filters-utils.ts. "Histórico completo" sits
 * right before "Personalizado": it is a deliberate, occasional choice, never
 * the default (see `ReportsContent`, which initializes to "this_month").
 */
export const REPORT_DATE_PRESETS: { key: ReportRangePreset; label: string }[] = [
  { key: "today", label: "Hoy" },
  { key: "this_week", label: "Esta semana" },
  { key: "this_month", label: "Este mes" },
  { key: "last_3_months", label: "Últimos 3 meses" },
  { key: "full_history", label: "Histórico completo" },
  { key: "custom", label: "Personalizado" },
];

/**
 * The earliest date any real record can carry — the club's own founding date
 * (`landing-config.ts`), not an arbitrary sentinel. No persona, attendance
 * record or payment predates the club itself, so this is a safe lower bound
 * for "histórico completo" without querying the data for its actual minimum.
 */
const FOUNDING_DATE_ISO = calendarIsoDate(
  new Date(FOUNDING_DATE.year, FOUNDING_DATE.month - 1, FOUNDING_DATE.day, 12),
);

/**
 * Resolve a report preset into `{ fechaInicio, fechaFin }`.
 *
 * `today`/`this_week`/`this_month`/`custom` delegate to the shared
 * `buildDateRange` — one definition of "this week" for the whole app.
 * `last_3_months` and `full_history` are report-only: no other screen has
 * asked for either yet.
 *
 * `full_history` always resolves BOTH ends (never an open range) so that the
 * período report — whose backend requires both — never receives a partial
 * request. The other two reports treat this identically to "no bounds",
 * since the founding date is provably before their earliest possible row.
 */
export function buildReportDateRange(preset: ReportRangePreset, now: Date = new Date()): DateRange {
  const today = clubToday(now);
  const todayIso = calendarIsoDate(today);

  if (preset === "last_3_months") {
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1, 12);
    return { fechaInicio: calendarIsoDate(start), fechaFin: todayIso };
  }
  if (preset === "full_history") {
    return { fechaInicio: FOUNDING_DATE_ISO, fechaFin: todayIso };
  }
  return buildDateRange(preset, now);
}

// ---------------------------------------------------------------------------
// "Nuevos miembros por período" pagination
// ---------------------------------------------------------------------------

/** Results per page for the persona report table. */
export const PERSONA_REPORT_PAGE_SIZE = 10;

/**
 * Slice a (possibly already filtered) persona report list to a single page.
 *
 * `page` is 1-indexed. Returns an empty array when `page` is beyond the
 * available data — never throws or wraps around.
 */
export function paginatePersonaResults(
  results: PersonaReporte[],
  page: number,
  pageSize: number = PERSONA_REPORT_PAGE_SIZE,
): PersonaReporte[] {
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize);
}

/**
 * Total number of pages for a given persona report result count.
 *
 * Always returns at least 1 (never 0 pages, even for an empty list) so
 * "Página 1 de 1" is a valid state to render.
 */
export function getPersonaReportTotalPages(
  totalResults: number,
  pageSize: number = PERSONA_REPORT_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalResults / pageSize));
}

// ---------------------------------------------------------------------------
// "Asistencia" report pagination
// ---------------------------------------------------------------------------

/** Results per page for the attendance report table. */
export const ASISTENCIA_REPORT_PAGE_SIZE = 10;

/**
 * Slice a (possibly already filtered) attendance report list to a single page.
 *
 * `page` is 1-indexed. Returns an empty array when `page` is beyond the
 * available data — never throws or wraps around.
 */
export function paginateAsistenciaResults(
  results: AttendanceRecord[],
  page: number,
  pageSize: number = ASISTENCIA_REPORT_PAGE_SIZE,
): AttendanceRecord[] {
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize);
}

/**
 * Total number of pages for a given attendance report result count.
 *
 * Always returns at least 1 (never 0 pages, even for an empty list) so
 * "Página 1 de 1" is a valid state to render.
 */
export function getAsistenciaReportTotalPages(
  totalResults: number,
  pageSize: number = ASISTENCIA_REPORT_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalResults / pageSize));
}

// ---------------------------------------------------------------------------
// "Pagos" report pagination
// ---------------------------------------------------------------------------

/** Results per page for the payments report table. */
export const PAGOS_REPORT_PAGE_SIZE = 10;

/**
 * Slice a (possibly already filtered) payments report list to a single page.
 *
 * `page` is 1-indexed. Returns an empty array when `page` is beyond the
 * available data — never throws or wraps around.
 */
export function paginatePagosResults(
  results: PaymentValidationRequest[],
  page: number,
  pageSize: number = PAGOS_REPORT_PAGE_SIZE,
): PaymentValidationRequest[] {
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize);
}

/**
 * Total number of pages for a given payments report result count.
 *
 * Always returns at least 1 (never 0 pages, even for an empty list) so
 * "Página 1 de 1" is a valid state to render.
 */
export function getPagosReportTotalPages(
  totalResults: number,
  pageSize: number = PAGOS_REPORT_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalResults / pageSize));
}

// The CSV export that used to live here (`csvField`/`toCsv`/`csvFilename`/
// `downloadCsv`) was replaced by the `.xlsx` export in `xlsx-export.ts`
// (issue #864) — typed date/number/currency cells and correct Spanish
// accents without a byte-order mark, which CSV could not offer.
