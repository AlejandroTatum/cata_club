/**
 * Pure helpers behind the shared attendance filter panel.
 *
 * Kept free of React so the range rules can be tested directly, following the
 * repo's `*-utils.ts` convention (see src/app/attendance/attendance-utils.ts).
 */

import {
  DIA_SEMANA_LABELS,
  formatDay,
  UNCATEGORIZED_SCHEDULE_LABEL,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { buildDateRange, type DateRangePreset } from "@/lib/club-date";

/** The query `fetchAttendanceRecords` takes — every key optional, all of them omitted when unset. */
export interface AttendanceQuery {
  fechaInicio?: string;
  fechaFin?: string;
  horarioId?: number;
  /**
   * Every horario id of a slot chosen with "Todos los días". The records
   * endpoint takes ONE `horarioId`, so this never reaches the wire: the page
   * fetches the whole range and narrows with `narrowToHorarios`.
   */
  horarioIds?: number[];
  personaId?: number;
}

/** The part of the query the API understands — `horarioIds` stays client-side. */
export function toApiParams(query: AttendanceQuery): Omit<AttendanceQuery, "horarioIds"> {
  const { horarioIds: _ignored, ...params } = query;
  return params;
}

/** Keep only the rows of the slot's horarios; a no-op without `horarioIds`. */
export function narrowToHorarios<T extends { horarioId: number }>(
  rows: readonly T[],
  query: AttendanceQuery | null,
): T[] {
  const ids = query?.horarioIds;
  if (!ids) return [...rows];
  const allowed = new Set(ids);
  return rows.filter((row) => allowed.has(row.horarioId));
}

/** Same narrowing for the schedule catalog, by `id`. */
export function narrowSchedules(
  schedules: readonly TrainingSchedule[],
  query: AttendanceQuery | null,
): TrainingSchedule[] {
  const ids = query?.horarioIds;
  if (!ids) return [...schedules];
  const allowed = new Set(ids);
  return schedules.filter((schedule) => allowed.has(schedule.id));
}

/** One distinct time slot of a category, shared by every day it runs. */
export interface ScheduleSlot {
  key: string;
  /** "Category · HH:MM–HH:MM". */
  label: string;
  schedules: TrainingSchedule[];
}

/**
 * Distinct slots (category + start + end), deduped across days. Ordered by
 * category (es collation) then start time, so the select reads as a timetable.
 */
export function buildScheduleSlots(schedules: readonly TrainingSchedule[]): ScheduleSlot[] {
  const dayOrder = Object.keys(DIA_SEMANA_LABELS);
  const slots = new Map<string, ScheduleSlot & { category: string; start: string }>();
  for (const schedule of schedules) {
    const category = schedule.categoriaLabel || UNCATEGORIZED_SCHEDULE_LABEL;
    const key = `${category}|${schedule.horaInicio}|${schedule.horaFin}`;
    const slot = slots.get(key) ?? {
      key,
      category,
      start: schedule.horaInicio,
      label: `${category} · ${schedule.horaInicio}–${schedule.horaFin}`,
      schedules: [],
    };
    slot.schedules.push(schedule);
    slots.set(key, slot);
  }
  return Array.from(slots.values())
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category, "es") || a.start.localeCompare(b.start),
    )
    .map(({ key, label, schedules: items }) => ({
      key,
      label,
      schedules: [...items].sort(
        (a, b) => dayOrder.indexOf(a.diaSemana) - dayOrder.indexOf(b.diaSemana),
      ),
    }));
}

/** The days a slot runs, Monday first, as `{ id, label }` options. */
export function slotDayOptions(slot: ScheduleSlot | undefined): { id: number; label: string }[] {
  return (slot?.schedules ?? []).map((schedule) => ({
    id: schedule.id,
    label: formatDay(schedule.diaSemana),
  }));
}

/**
 * Map the two dependent controls onto query fields: a day → its single
 * `horarioId`; a slot with "Todos los días" → `horarioIds`; nothing → `{}`.
 * An unknown slot (schedules reloaded, stale key) selects nothing.
 */
export function resolveScheduleFilter(
  slots: readonly ScheduleSlot[],
  slotKey: string | null,
  dayId: number | null,
): Pick<AttendanceQuery, "horarioId" | "horarioIds"> {
  if (slotKey === null) return {};
  const slot = slots.find((candidate) => candidate.key === slotKey);
  if (!slot) return {};
  if (dayId !== null && slot.schedules.some((schedule) => schedule.id === dayId)) {
    return { horarioId: dayId };
  }
  return { horarioIds: slot.schedules.map((schedule) => schedule.id) };
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
  horarioIds?: number[];
  personaId: number | null;
}): AttendanceQuery | null {
  const { preset, customStart, customEnd, horarioId, horarioIds, personaId } = input;

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
  else if (horarioIds) query.horarioIds = horarioIds;
  if (personaId !== null) query.personaId = personaId;
  return query;
}

/** The inline validation message for the two custom-range pickers, or `null`. */
export function customRangeError(start: string, end: string): string | null {
  return start && end && end < start ? RANGE_ERROR : null;
}
