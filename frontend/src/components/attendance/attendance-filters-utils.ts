/**
 * Pure helpers behind the shared attendance filter panel.
 *
 * Kept free of React so the range rules can be tested directly, following the
 * repo's `*-utils.ts` convention (see src/app/attendance/attendance-utils.ts).
 */

import { buildDateRange, type DateRangePreset } from "@/lib/club-date";

/** The query `fetchAttendanceRecords` takes — every key optional, all of them omitted when unset. */
export interface AttendanceQuery {
  fechaInicio?: string;
  fechaFin?: string;
  horarioId?: number;
  personaId?: number;
}

/**
 * The single message for an inverted custom range. Shown next to the pickers,
 * never as a toast: the fix is right there in the two inputs.
 */
export const RANGE_ERROR = "La fecha límite no puede ser menor que la fecha de inicio.";

/**
 * `Hoy` first, `Rango personalizado` last — the presets read as a widening
 * funnel, and the escape hatch belongs at the end of it.
 */
export const DATE_PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "Hoy" },
  { key: "this_week", label: "Esta semana" },
  { key: "this_month", label: "Este mes" },
  { key: "custom", label: "Rango personalizado" },
];

/** `true` once both ends of a custom range are set AND ordered. */
export function isCustomRangeComplete(start: string, end: string): boolean {
  return Boolean(start && end && end >= start);
}

/**
 * Resolve the current filter selection into a query, or `null` when a custom
 * range is still half-filled or inverted.
 *
 * `null` is deliberately distinct from `{}`: an incomplete range must blank the
 * table rather than silently fall back to "everything", which would leave rows
 * on screen that no longer match what the controls say.
 */
export function buildAttendanceQuery(input: {
  preset: DateRangePreset;
  customStart: string;
  customEnd: string;
  horarioId: number | null;
  personaId: number | null;
}): AttendanceQuery | null {
  const { preset, customStart, customEnd, horarioId, personaId } = input;

  let range: { fechaInicio: string; fechaFin: string };
  if (preset === "custom") {
    if (!isCustomRangeComplete(customStart, customEnd)) return null;
    range = { fechaInicio: customStart, fechaFin: customEnd };
  } else {
    range = buildDateRange(preset);
  }

  const query: AttendanceQuery = {};
  if (range.fechaInicio) query.fechaInicio = range.fechaInicio;
  if (range.fechaFin) query.fechaFin = range.fechaFin;
  if (horarioId !== null) query.horarioId = horarioId;
  if (personaId !== null) query.personaId = personaId;
  return query;
}

/** The inline validation message for the two custom-range pickers, or `null`. */
export function customRangeError(start: string, end: string): string | null {
  return start && end && end < start ? RANGE_ERROR : null;
}
