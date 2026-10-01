/**
 * Pure utility functions for the Reportes admin page.
 *
 * No React dependencies — pure functions for testability. Mirrors the
 * client-side pagination pattern established in members-utils.ts and
 * attendance-utils.ts: each report tab keeps its own page-size constant
 * and paginate/getTotalPages pair since they're independent datasets.
 */

import type { PersonaReporte } from "@/types/domain";
import {
  DIA_SEMANA_LABELS,
  formatDay,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
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

// ---------------------------------------------------------------------------
// Schedule slot → day picker
// ---------------------------------------------------------------------------
//
// The attendance filter used to list every day+time Horario row (~100
// options). It is now two dependent selects: the distinct slot (category +
// time range, deduped across days), then the day within that slot. The pair
// maps back to the horario ids the API already filters by.

export interface ScheduleSlot {
  /** Stable dedupe key: category label + time range. */
  key: string;
  label: string;
}

export interface SlotDay {
  id: number;
  label: string;
}

function slotKeyOf(h: TrainingSchedule): string {
  return `${h.categoriaLabel ?? ""}|${h.horaInicio}|${h.horaFin}`;
}

const DAY_ORDER = Object.keys(DIA_SEMANA_LABELS);

/** Distinct schedule slots, ordered by start time then category. */
export function buildScheduleSlots(horarios: TrainingSchedule[]): ScheduleSlot[] {
  const seen = new Map<string, TrainingSchedule>();
  for (const h of horarios) {
    const key = slotKeyOf(h);
    if (!seen.has(key)) seen.set(key, h);
  }
  return [...seen.entries()]
    .sort(
      ([, a], [, b]) =>
        a.horaInicio.localeCompare(b.horaInicio) ||
        a.horaFin.localeCompare(b.horaFin) ||
        (a.categoriaLabel ?? "").localeCompare(b.categoriaLabel ?? ""),
    )
    .map(([key, h]) => {
      const range = `${h.horaInicio}–${h.horaFin}`;
      return { key, label: h.categoriaLabel ? `${h.categoriaLabel} · ${range}` : range };
    });
}

/** The days a slot runs on, in week order. Unknown slot → empty. */
export function daysForSlot(horarios: TrainingSchedule[], slotKey: string): SlotDay[] {
  if (!slotKey) return [];
  return horarios
    .filter((h) => slotKeyOf(h) === slotKey)
    .sort((a, b) => DAY_ORDER.indexOf(a.diaSemana) - DAY_ORDER.indexOf(b.diaSemana))
    .map((h) => ({ id: h.id, label: formatDay(h.diaSemana) }));
}

/**
 * Horario ids behind the (slot, day) pair. No slot → no filter (empty).
 * Slot with "all days" → every day's id. A day outside the slot is ignored.
 */
export function resolveHorarioIds(
  horarios: TrainingSchedule[],
  slotKey: string,
  dayId: string,
): number[] {
  const days = daysForSlot(horarios, slotKey);
  const picked = days.find((d) => String(d.id) === dayId);
  return picked ? [picked.id] : days.map((d) => d.id);
}

// The CSV export that used to live here (`csvField`/`toCsv`/`csvFilename`/
// `downloadCsv`) was replaced by the `.xlsx` export in `xlsx-export.ts`
// (issue #864) — typed date/number/currency cells and correct Spanish
// accents without a byte-order mark, which CSV could not offer.
