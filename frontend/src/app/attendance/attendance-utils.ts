/**
 * Pure utility functions and mock data for the admin Asistencias page.
 *
 * Admin overview: available schedules (Horario) and recent attendance records
 * (Asistencia). This is separate from the trainer attendance flow
 * (src/app/trainer/attendance/) which is for marking attendance per session.
 *
 * No React dependencies — pure functions for testability.
 */

import type { DiaSemana, NivelTecnico, EstadoAsistencia } from "@/types/domain";
import type { BadgeTone } from "@/components/ui/Badge";
import { MONTH_ABBR } from "@/lib/format-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A training schedule slot, displayed in the admin overview.
 *
 * The `nivel` field this interface used to carry was marked `@deprecated`
 * ("technical level belongs to Grupo, not ScheduleSlot") and its only reader
 * was `getScheduleLevelLabel`, itself uncalled. Both are gone: a deprecated
 * field nobody reads is not backward compatibility, it is a second answer to
 * "what level is this?" sitting in the type where someone will eventually
 * believe it. Level comes from `Grupo.nivel`.
 */
export interface ScheduleSlot {
  id: string;
  diaSemana: DiaSemana;
  horaInicio: string;
  horaFin: string;
  cancha: string;
  cupoMaximo: number;
  activo: boolean;
}

/**
 * A real training schedule slot (Horario), as returned by
 * `GET /api/attendance/schedules` (proxying FastAPI's `/asistencias/horarios`).
 *
 * Deliberately leaner than `ScheduleSlot`: the real `HorarioResponseDTO` has
 * no `cancha`, `cupoMaximo`, `activo`, or nivel/group linkage — those mock
 * fields have no backend equivalent (see `src/lib/server/attendance-adapter.ts`
 * for the documented gap). Only what the backend actually returns is modeled
 * here; the admin page renders accordingly.
 */
export interface TrainingSchedule {
  id: number;
  diaSemana: DiaSemana;
  /** "HH:mm", seconds already trimmed by the adapter. */
  horaInicio: string;
  horaFin: string;
  entrenadorId: number;
  /** Titular trainer's display name — resolved server-side from `/personas`. */
  entrenadorNombre: string;
  nivelRankingId: number | null;
}

/** A recent attendance record, enriched with student/trainer names. */
export interface AttendanceRecord {
  id: string;
  fecha: string;
  horario: string;
  /** Raw persona id of the student — lets callers (e.g. the trainer
   *  attendance wizard) match this record against a roster entry by id
   *  instead of only having the display name to go on. */
  personaId: number;
  estudiante: string;
  estado: EstadoAsistencia;
  entrenador: string;
}

/** Aggregate counts for today's attendance overview. */
export interface AttendanceDayStats {
  totalPresent: number;
  totalAbsent: number;
  totalLate: number;
  totalJustified: number;
  /** Count of records with an unknown/unexpected estado value. */
  totalUnknown: number;
  totalStudents: number;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const DIA_SEMANA_LABELS: Record<DiaSemana, string> = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

export const NIVEL_LABELS: Record<NivelTecnico, string> = {
  principiante: "Principiante",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
};

/** Human-readable labels for each attendance state, in Spanish. */
export const ATTENDANCE_LABELS: Record<EstadoAsistencia, string> = {
  present: "Presente",
  absent: "Ausente",
  late: "Tardanza",
  justified: "Justificado",
};

// ---------------------------------------------------------------------------
// Badge color tokens (Fase 3b — B4 light-theme migration)
// ---------------------------------------------------------------------------

/** Badge/icon color classes for a given attendance state. */
export interface AttendanceBadgeTokens {
  badgeClass: string;
  iconClass: string;
}

/**
 * Light-theme color tokens for each attendance badge state.
 * `present` reuses the shared `cata-state-ok` success token (B4); the rest
 * follow the same `-50`/`-700` Tailwind semantic-scale pairing already
 * established for payments' status badges, for text+color distinguishability
 * (WCAG AA — see admin-light-theme spec).
 */
export const ATTENDANCE_BADGE_TOKENS: Record<EstadoAsistencia, AttendanceBadgeTokens> = {
  present: { badgeClass: "bg-cata-state-ok/10 text-cata-state-ok", iconClass: "text-cata-state-ok" },
  absent: { badgeClass: "bg-red-50 text-red-700", iconClass: "text-red-700" },
  late: { badgeClass: "bg-amber-50 text-amber-700", iconClass: "text-amber-700" },
  justified: { badgeClass: "bg-blue-50 text-blue-700", iconClass: "text-blue-700" },
};

/** Neutral fallback tokens for an unrecognized estado value at runtime. */
const FALLBACK_BADGE_TOKENS: AttendanceBadgeTokens = {
  badgeClass: "bg-cata-border/40 text-cata-text/65",
  iconClass: "text-cata-text/65",
};

/**
 * Get the light-theme badge/icon color classes for an attendance estado.
 *
 * Returns a neutral fallback for unknown/unexpected estado values — never
 * throws, avoids rendering an unstyled badge for bad runtime data.
 *
 * Still the source of truth for the ICON colour (see `AttendanceStateIcon` in
 * the admin attendance page). The BADGE now renders through the `Badge`
 * primitive via `getAttendanceBadgeTone` below; `badgeClass` remains for the
 * one caller that tints a toggle surface rather than a pill.
 */
export function getAttendanceBadgeTokens(estado: string): AttendanceBadgeTokens {
  return ATTENDANCE_BADGE_TOKENS[estado as EstadoAsistencia] ?? FALLBACK_BADGE_TOKENS;
}

/**
 * `Badge` tone for each attendance state.
 *
 * The audit singled out `ATTENDANCE_BADGE_TOKENS` as the one concept in the
 * app with real cross-screen integrity: a single shared map, with
 * `trainer/page.tsx` carrying an explicit comment refusing to re-declare it.
 * That integrity is the thing worth keeping, so the migration onto the `Badge`
 * primitive happens HERE, in the same module, as one more map over the same
 * four keys — not as four `tone=` literals sprinkled across five screens where
 * they could drift apart again.
 *
 * The tones mirror `Badge`'s own doc comment: presente → ok, tardanza → warn,
 * justificado → neutral, ausente → bad. `justified` moves from blue to neutral
 * because the design system has no blue state pair; a justified absence is
 * informational, which is exactly what neutral means.
 */
export const ATTENDANCE_BADGE_TONES: Record<EstadoAsistencia, BadgeTone> = {
  present: "ok",
  absent: "bad",
  late: "warn",
  justified: "neutral",
};

/**
 * Get the `Badge` tone for an attendance estado.
 *
 * Mirrors `getAttendanceBadgeTokens`' defensive contract: an unknown runtime
 * value renders neutral rather than throwing or rendering an unstyled pill.
 */
export function getAttendanceBadgeTone(estado: string): BadgeTone {
  return ATTENDANCE_BADGE_TONES[estado as EstadoAsistencia] ?? "neutral";
}

/**
 * Label for an attendance estado, tolerant of unknown runtime values.
 *
 * Pairs with `getAttendanceBadgeTone` so a badge never renders an empty pill
 * for data the backend added after this build shipped.
 */
export function getAttendanceLabel(estado: string): string {
  return ATTENDANCE_LABELS[estado as EstadoAsistencia] ?? "Desconocido";
}

// Mock data has moved to src/mocks/attendance.ts.
// Import MOCK_SCHEDULES and MOCK_ATTENDANCE_RECORDS from @/mocks/attendance.

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Compute attendance statistics from a list of records.
 * Counts each attendance state and returns an aggregate summary.
 * Does NOT filter by date — the caller should pre-filter records if needed.
 * Returns zero-initialized stats when records is empty.
 */
export function buildAttendanceStats(
  records: AttendanceRecord[],
): AttendanceDayStats {
  let totalPresent = 0;
  let totalAbsent = 0;
  let totalLate = 0;
  let totalJustified = 0;
  let totalUnknown = 0;

  for (const record of records) {
    switch (record.estado) {
      case "present":
        totalPresent++;
        break;
      case "absent":
        totalAbsent++;
        break;
      case "late":
        totalLate++;
        break;
      case "justified":
        totalJustified++;
        break;
      default:
        totalUnknown++;
        break;
    }
  }

  return {
    totalPresent,
    totalAbsent,
    totalLate,
    totalJustified,
    totalUnknown,
    totalStudents: records.length,
  };
}

/**
 * Share of attendance records marked "present", as a rounded 0-100 percent.
 *
 * Returns 0 (not NaN) when there are no records to derive a rate from.
 */
export function getAttendanceRatePercent(stats: AttendanceDayStats): number {
  if (stats.totalStudents === 0) return 0;
  return Math.round((stats.totalPresent / stats.totalStudents) * 100);
}

/**
 * Format a DiaSemana value into a human-readable Spanish day name.
 *
 * Returns a fallback string when the value is not a known day.
 * Safety: never returns undefined — avoids rendering "undefined" in the UI.
 */
export function formatDay(dia: DiaSemana): string {
  return DIA_SEMANA_LABELS[dia] ?? `Día desconocido: ${dia}`;
}

/**
 * Get a human-readable label for a technical level.
 *
 * Returns a fallback string when the value is not a known level.
 * Safety: never returns undefined — avoids rendering "undefined" in the UI.
 */
export function formatNivel(nivel: NivelTecnico): string {
  return NIVEL_LABELS[nivel] ?? `Nivel desconocido: ${nivel}`;
}

/** Which schedules the picker shows, and why — see `selectVisibleSchedules`. */
export interface VisibleSchedules {
  schedules: TrainingSchedule[];
  /** The list is narrowed to today. Drives the "mostrando solo hoy" hint. */
  narrowedToToday: boolean;
  /**
   * Today has no sessions, so the full week is shown instead. Distinct from
   * "nothing loaded at all" — the UI must not blame the day filter for an
   * empty backend response.
   */
  emptyToday: boolean;
}

/**
 * Narrow the schedule picker to today by default, with the full week one tap
 * away.
 *
 * The default exists to save the common case a scan through the whole week;
 * it is deliberately NOT a hard filter. A trainer filing a session they
 * missed yesterday still needs every other day reachable, so `showAllDays`
 * always wins.
 *
 * When today has no sessions the narrowing is dropped rather than honoured:
 * an empty picker on a rest day reads as a broken screen, not as a filter.
 */
export function selectVisibleSchedules(
  schedules: TrainingSchedule[],
  today: DiaSemana,
  showAllDays: boolean,
): VisibleSchedules {
  if (showAllDays || schedules.length === 0) {
    return { schedules, narrowedToToday: false, emptyToday: false };
  }

  const todaySchedules = schedules.filter((schedule) => schedule.diaSemana === today);
  if (todaySchedules.length === 0) {
    return { schedules, narrowedToToday: false, emptyToday: true };
  }

  return { schedules: todaySchedules, narrowedToToday: true, emptyToday: false };
}

// ---------------------------------------------------------------------------
// Client-side pagination (PR3 — no backend page-through capability exists;
// see design.md decision #3)
// ---------------------------------------------------------------------------

/** Records per page for the attendance records table. */
export const ATTENDANCE_PAGE_SIZE = 10;

/**
 * Slice a (possibly already filtered) records list to a single page.
 *
 * `page` is 1-indexed. Returns an empty array when `page` is beyond the
 * available data — never throws or wraps around.
 */
export function paginateRecords<T>(
  records: T[],
  page: number,
  pageSize: number = ATTENDANCE_PAGE_SIZE,
): T[] {
  const start = (page - 1) * pageSize;
  return records.slice(start, start + pageSize);
}

/**
 * Total number of pages for a given record count.
 *
 * Always returns at least 1 (never 0 pages, even for an empty list) so
 * "Página 1 de 1" is a valid state to render.
 */
export function getTotalPages(
  totalRecords: number,
  pageSize: number = ATTENDANCE_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalRecords / pageSize));
}

// ---------------------------------------------------------------------------
// Human-readable dates (Fase 3 — "Hoy, 23 jul")
// ---------------------------------------------------------------------------

/**
 * Re-exported so existing importers of this module keep working; the table
 * itself lives in `lib/format-utils.ts`, the single source of truth for date
 * grammar. This module owns the "Hoy, 23 jul" phrasing, not the vocabulary.
 */
export { MONTH_ABBR };

/**
 * Parse either a date-only value ("YYYY-MM-DD") or a full ISO timestamp into a
 * Date in LOCAL terms.
 *
 * Date-only strings are built from their components rather than handed to
 * `new Date(str)`, which reads them as UTC midnight — that turns "today" into
 * "yesterday" for every user in America/Guayaquil (UTC-5). Same reasoning as
 * `format-utils.ts`'s own parser; see its docstring.
 */
function parseLocalDate(value: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day);
    if (date.getMonth() !== month || date.getDate() !== day) return null;
    return date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole-day difference between two dates, ignoring the time of day. */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * Humanise a date for a list cell: "Hoy, 23 jul", "Ayer, 22 jul", "12 jul",
 * and "12 jul 2025" once the year stops being the current one.
 *
 * This is a SECOND date grammar next to `formatDate`'s `dd/mm/yyyy`, and that
 * is the approved decision, not an oversight: on the attendance log and the
 * activity feed the question is "how recent is this?", which a numeric date
 * makes the reader compute. Anywhere the question is "which exact day?" —
 * periods, validation stamps, report ranges — `formatDate` still rules.
 *
 * Returns "" for unparseable input, like every other formatter in the product.
 */
export function formatHumanDate(dateStr: string, today: Date = new Date()): string {
  const date = parseLocalDate(dateStr);
  if (!date) return "";

  const dayMonth = `${date.getDate()} ${MONTH_ABBR[date.getMonth()]}`;
  const delta = calendarDaysBetween(date, today);
  if (delta === 0) return `Hoy, ${dayMonth}`;
  if (delta === 1) return `Ayer, ${dayMonth}`;
  if (date.getFullYear() !== today.getFullYear()) return `${dayMonth} ${date.getFullYear()}`;
  return dayMonth;
}

// ---------------------------------------------------------------------------
// Schedule ↔ day grouping (PR3 — Horarios de Entrenamiento density)
// ---------------------------------------------------------------------------

/** One day's worth of schedules, in the grouped Horarios layout. */
export interface ScheduleDayGroup {
  day: DiaSemana;
  label: string;
  schedules: TrainingSchedule[];
}

/**
 * Group schedules by `diaSemana`, ordered Lunes → Domingo regardless of
 * input order (order derived from `DIA_SEMANA_LABELS`' key order). Days
 * with no schedules are omitted — never renders an empty day section.
 */
export function groupSchedulesByDay(
  schedules: TrainingSchedule[],
): ScheduleDayGroup[] {
  const grouped: Partial<Record<DiaSemana, TrainingSchedule[]>> = {};
  for (const schedule of schedules) {
    const bucket = grouped[schedule.diaSemana] ?? (grouped[schedule.diaSemana] = []);
    bucket.push(schedule);
  }

  const dayOrder = Object.keys(DIA_SEMANA_LABELS) as DiaSemana[];
  return Object.entries(grouped)
    .map(([day, daySchedules]) => ({
      day: day as DiaSemana,
      label: DIA_SEMANA_LABELS[day as DiaSemana],
      schedules: daySchedules ?? [],
    }))
    .sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));
}
