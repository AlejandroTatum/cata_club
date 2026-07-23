/**
 * Pure utility functions for the Trainer Attendance flow.
 *
 * Extracted from page.tsx for testability — no React dependencies.
 *
 * Domain: the wizard selects a real Horario (`GET /api/attendance/schedules`)
 * and derives the roster directly from that Horario's assigned alumnos
 * (`GET /api/groups/horarios/:id/alumnos`) — no separate nivel/grupo
 * selection is involved.
 */

import type { EstadoAsistencia, UserRole } from "@/types/domain";
import type { AlumnoHorario } from "@/services/api";
import type { AttendanceRecord, TrainingSchedule } from "@/app/attendance/attendance-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionStudent {
  id: string;
  name: string;
  attendance: EstadoAsistencia;
}

// ---------------------------------------------------------------------------
// Attendance helpers
// ---------------------------------------------------------------------------

/** Human-readable labels for each attendance state, in Spanish. */
export const ATTENDANCE_LABELS: Record<EstadoAsistencia, string> = {
  present: "Presente",
  absent: "Ausente",
  late: "Tardanza",
  justified: "Justificado",
};

// Badge/status color tokens for each attendance state come from the shared
// `getAttendanceBadgeTokens` in `@/app/attendance/attendance-utils` (Fase 3b
// — B4), imported directly by page.tsx. This keeps trainer attendance's
// badge/status colors byte-identical to the admin attendance view instead of
// maintaining a second, drifting color-mapping Record here.

/** All possible attendance states for the toggle. */
export const ATTENDANCE_STATES: EstadoAsistencia[] = [
  "present",
  "absent",
  "late",
  "justified",
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Cycle to the next attendance state in a defined order:
 * absent → present → late → justified → absent → ...
 *
 * This provides a predictable toggle sequence for the UI.
 */
export function nextAttendanceState(
  current: EstadoAsistencia,
): EstadoAsistencia {
  const order: EstadoAsistencia[] = ["absent", "present", "late", "justified"];
  const idx = order.indexOf(current);
  if (idx === -1 || idx === order.length - 1) return order[0];
  return order[idx + 1];
}

/**
 * Count how many students have a given attendance state.
 */
export function countByState(
  students: SessionStudent[],
  state: EstadoAsistencia,
): number {
  return students.filter((s) => s.attendance === state).length;
}

/**
 * Build a human-readable summary of attendance counts.
 * e.g. "5 presente • 2 ausente • 1 tardanza • 0 justificado"
 */
export function buildAttendanceSummary(students: SessionStudent[]): string {
  const parts = ATTENDANCE_STATES.map((state) => {
    const count = countByState(students, state);
    const label = ATTENDANCE_LABELS[state].toLowerCase();
    return `${count} ${label}`;
  });
  return parts.join(" • ");
}

/**
 * Build the roster to mark attendance for from a Horario's assigned alumnos
 * (`GET /groups/horarios/:id/alumnos`), defaulting every student to "absent"
 * — the trainer marks who was actually present from there.
 *
 * `existingRecords` — attendance already registered for this exact session
 * (today's date + this horarioId, see `fetchAttendanceRecords`). When a
 * student already has a record, their prior `estado` is used to prefill the
 * roster instead of defaulting to "absent" — reopening the "Tomar
 * asistencia" wizard for an already-registered session must show what was
 * actually recorded, not silently reset everyone to Ausente (bug fix: this
 * previously caused resubmission to look like it created 45 new "Ausente"
 * rows instead of updating the 2 existing "Presente" ones).
 */
export function buildRosterFromAlumnoHorarios(
  items: AlumnoHorario[],
  existingRecords: AttendanceRecord[] = [],
): SessionStudent[] {
  const estadoByPersonaId = new Map<number, EstadoAsistencia>(
    existingRecords.map((record) => [record.personaId, record.estado]),
  );
  return items.map((item) => ({
    id: String(item.personaId),
    name: item.personaNombreCompleto,
    attendance: estadoByPersonaId.get(item.personaId) ?? ("absent" as EstadoAsistencia),
  }));
}

// ---------------------------------------------------------------------------
// Admin-on-behalf-of-trainer resolution (PR8): backend's `_validar_entrenador`
// requires `entrenador_id` to belong to an ENTRENADOR — an admin's own id
// never qualifies, so the schedule's titular trainer is submitted instead.
// ---------------------------------------------------------------------------

type ScheduleEntrenador = Pick<TrainingSchedule, "entrenadorId" | "entrenadorNombre">;

/** Resolve the persona id to submit as `entrenadorId` on the record. */
export function resolveEntrenadorId(
  role: UserRole | null,
  sessionUserId: string | number | null | undefined,
  selectedSchedule: ScheduleEntrenador | null,
): number | null {
  if (role === "admin") {
    return selectedSchedule?.entrenadorId ?? null;
  }
  if (sessionUserId === null || sessionUserId === undefined) return null;
  const parsed = Number(sessionUserId);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Resolve the trainer name shown in "Registrando como" copy — mirrors `resolveEntrenadorId`. */
export function resolveDisplayTrainerName(
  role: UserRole | null,
  sessionUserName: string | null | undefined,
  selectedSchedule: ScheduleEntrenador | null,
): string {
  if (role === "admin") {
    return selectedSchedule?.entrenadorNombre ?? "Entrenador";
  }
  return sessionUserName ?? "Entrenador";
}
