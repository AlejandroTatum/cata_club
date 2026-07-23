/**
 * Pure utility functions and mock data for the admin Asistencias page.
 *
 * Admin overview: available schedules (Horario) and recent attendance records
 * (Asistencia). This is separate from the trainer attendance flow
 * (src/app/trainer/attendance/) which is for marking attendance per session.
 *
 * No React dependencies — pure functions for testability.
 */

import type { DiaSemana, NivelTecnico, EstadoAsistencia, Grupo } from "@/types/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A training schedule slot, displayed in the admin overview. */
export interface ScheduleSlot {
  id: string;
  diaSemana: DiaSemana;
  horaInicio: string;
  horaFin: string;
  /**
   * @deprecated — Technical level belongs to Grupo, not ScheduleSlot.
   * Kept for backward compatibility with mock data; do NOT use for domain
   * decisions. Derive display level from the linked Grupo.nivel instead.
   */
  nivel: NivelTecnico;
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
  /** Raw persona id of the student — used to match records back to a roster entry (e.g. prefilling the trainer wizard). */
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
 */
export function getAttendanceBadgeTokens(estado: string): AttendanceBadgeTokens {
  return ATTENDANCE_BADGE_TOKENS[estado as EstadoAsistencia] ?? FALLBACK_BADGE_TOKENS;
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

/**
 * Count active schedules from a list.
 */
export function countActiveSchedules(schedules: ScheduleSlot[]): number {
  return schedules.filter((s) => s.activo).length;
}

const JS_DAY_INDEX_TO_DIA_SEMANA: DiaSemana[] = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

/**
 * Map JS `Date.getDay()` (0 = Sunday .. 6 = Saturday) to the backend-aligned
 * `DiaSemana` short code — used by the trainer dashboard to find today's
 * real schedules. Falls back to "lun" for an out-of-range index (never
 * throws, same defensive pattern as `formatDay`/`formatNivel`).
 */
export function jsDayIndexToDiaSemana(dayIndex: number): DiaSemana {
  return JS_DAY_INDEX_TO_DIA_SEMANA[dayIndex] ?? "lun";
}

// ---------------------------------------------------------------------------
// Schedule ↔ Group reconciliation helpers
// ---------------------------------------------------------------------------

/**
 * Build a map of scheduleId → linked group names.
 *
 * Used by the admin Asistencias page to show which groups link
 * to each schedule slot.
 */
export function buildScheduleGroupMap(
  grupos: Grupo[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const grupo of grupos) {
    if (!grupo.horariosIds) continue;
    for (const horarioId of grupo.horariosIds) {
      if (!map[horarioId]) map[horarioId] = [];
      map[horarioId].push(grupo.nombre);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Client-side pagination (PR3 — no backend page-through capability exists;
// see design.md decision #3)
// ---------------------------------------------------------------------------

/** Records per page for the attendance records table. */
export const ATTENDANCE_PAGE_SIZE = 25;

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

/**
 * Derive the display level label for a schedule slot.
 *
 * Prefers the linked group's technical level (Grupo.nivel) over the
 * deprecated ScheduleSlot.nivel. Falls back to formatNivel(slot.nivel)
 * only when no group links to this schedule.
 *
 * Tie-breaking: when multiple groups share a schedule WITH MISMATCHED
 * levels, the first group found wins. This is a known limitation —
 * groups sharing a schedule should have the same level in practice.
 * See tests for the documented behavior.
 */
export function getScheduleLevelLabel(
  slot: ScheduleSlot,
  grupos: Grupo[],
): string {
  const linkedGrupos = grupos.filter(
    (g) => g.horariosIds?.includes(slot.id),
  );
  if (linkedGrupos.length > 0) {
    const level = linkedGrupos[0].nivel;
    return NIVEL_LABELS[level] ?? formatNivel(level);
  }
  return formatNivel(slot.nivel);
}
