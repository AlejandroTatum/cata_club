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
import type { AlumnoHorario, AttendanceStudentMark } from "@/services/api";
import type { AttendanceRecord, TrainingSchedule } from "@/app/attendance/attendance-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Frontend-only sentinel for "the trainer has not decided yet".
 *
 * The backend contract (`AttendanceStudentMark.estado`) only accepts the four
 * real `EstadoAsistencia` values, so this value is NEVER submitted: the wizard
 * blocks the advance/confirm buttons while any student still carries it, and
 * `toAttendanceMarks` strips it as a second line of defense.
 *
 * It exists because defaulting the roster to "absent" is indistinguishable
 * from a trainer deliberately marking everyone absent — which let a whole
 * session be filed as a no-show by tapping straight through the wizard.
 */
export const UNMARKED = "unmarked";

/** Attendance value a roster row can hold inside the wizard, before submission. */
export type WizardAttendance = EstadoAsistencia | typeof UNMARKED;

export interface SessionStudent {
  id: string;
  name: string;
  attendance: WizardAttendance;
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
 * The order tapping a student's row walks through
 * (`docs/ux/prototipos/20-tomar-lista.html`):
 *
 *   Sin marcar → Presente → Tardanza → Justificado → Ausente → Presente → …
 *
 * "Presente" comes first because it is the overwhelmingly common answer: one
 * tap should settle the common case, not the rarest one.
 *
 * `UNMARKED` is an ENTRY point only — the cycle never returns to it. Tapping
 * is an accelerator over the four explicit controls, and an accelerator that
 * can silently un-decide a student would hand back exactly the ambiguity the
 * sentinel exists to remove. A trainer who wants to undo a mark has the four
 * explicit controls right there.
 */
export function cycleWizardAttendance(current: WizardAttendance): EstadoAsistencia {
  switch (current) {
    case UNMARKED:
      return "present";
    case "present":
      return "late";
    case "late":
      return "justified";
    case "justified":
      return "absent";
    case "absent":
    default:
      return "present";
  }
}

/**
 * Names of the students whose records the backend could not save.
 *
 * `RegisterAttendanceResult.failed` comes back as `{ personaId, message }[]`.
 * The screen used to report "N registro(s) no se pudieron guardar" and then
 * ask the trainer to retry "for those students" — students it refused to
 * identify. Ids are matched against the roster the trainer just worked
 * through; an id with no matching row falls back to the id itself rather than
 * disappearing from the list, because a partially-named failure is still more
 * actionable than a count.
 */
export function resolveFailedStudentNames(
  failed: { personaId: number }[],
  students: SessionStudent[],
): string[] {
  const nameById = new Map(students.map((s) => [s.id, s.name]));
  return failed.map((f) => nameById.get(String(f.personaId)) ?? `Alumno #${f.personaId}`);
}

/**
 * Count how many students have a given attendance state.
 *
 * `UNMARKED` students match none of the four real states, so they are never
 * silently folded into the "absent" tally.
 */
export function countByState(
  students: SessionStudent[],
  state: EstadoAsistencia,
): number {
  return students.filter((s) => s.attendance === state).length;
}

/**
 * Count how many students the trainer has not decided on yet.
 *
 * Callers must pass the FULL roster, not the current page — the wizard
 * paginates at 10 while the roster can be far larger, and an off-page
 * unmarked student is precisely the one that used to be submitted as absent
 * without ever being seen.
 */
export function countUnmarked(students: SessionStudent[]): number {
  return students.filter((s) => s.attendance === UNMARKED).length;
}

/**
 * Bulk action for the common case (near-full attendance): promote every
 * still-unmarked student to "present", leaving explicit marks untouched.
 * Returns a new array — never mutates the input.
 */
export function markUnmarkedAsPresent(students: SessionStudent[]): SessionStudent[] {
  return students.map((s) =>
    s.attendance === UNMARKED ? { ...s, attendance: "present" as EstadoAsistencia } : s,
  );
}

/**
 * Project the roster onto the backend payload shape, dropping any student
 * still on the `UNMARKED` sentinel (the backend only accepts the four real
 * `EstadoAsistencia` values and would reject the batch otherwise).
 */
export function toAttendanceMarks(students: SessionStudent[]): AttendanceStudentMark[] {
  return students
    .filter((s): s is SessionStudent & { attendance: EstadoAsistencia } => s.attendance !== UNMARKED)
    .map((s) => ({ personaId: Number(s.id), estado: s.attendance }));
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
 * (`GET /groups/horarios/:id/alumnos`), defaulting every student to the
 * `UNMARKED` sentinel — the trainer must make an explicit decision for each
 * one before the wizard lets the session be submitted.
 *
 * `existingRecords` is optional — pass today's `AttendanceRecord[]` for this
 * same horario (see `fetchAttendanceRecords`) to pre-select each student's
 * already-registered `estado` instead of always defaulting to absent. This
 * is what makes re-opening the wizard for a session that already has
 * recorded attendance show the existing marks (and, combined with the
 * backend upsert in `registrar_asistencia`, resubmitting updates those rows
 * instead of creating duplicates).
 */
export function buildRosterFromAlumnoHorarios(
  items: AlumnoHorario[],
  existingRecords: AttendanceRecord[] = [],
): SessionStudent[] {
  const estadoByPersonaId = new Map(existingRecords.map((r) => [r.personaId, r.estado]));
  return items.map((item) => ({
    id: String(item.personaId),
    name: item.personaNombreCompleto,
    attendance: estadoByPersonaId.get(item.personaId) ?? (UNMARKED as WizardAttendance),
  }));
}

// ---------------------------------------------------------------------------
// Draft persistence
//
// The audit's finding: a phone call mid-roll-call loses the whole session,
// because nothing survives the component unmounting. The draft below closes
// that WITHOUT weakening the `UNMARKED` guarantee, and the rules are what make
// that true:
//
//   1. Only the four REAL states are ever written or read. `UNMARKED` is never
//      persisted, so a draft can never restore a student to "undecided" and it
//      can never introduce a mark the trainer did not make.
//   2. The key includes the horario AND the date, so yesterday's draft can
//      never be replayed onto today's session.
//   3. Restoring only ever narrows: a student absent from the draft keeps
//      whatever the roster gave them (a server record, or `UNMARKED`).
//   4. Anything malformed is discarded wholesale rather than partially
//      trusted.
//
// `sessionStorage`, not `localStorage`: a draft is scoped to the tab the
// trainer is standing there with, and must not outlive it on a shared device.
// ---------------------------------------------------------------------------

/** Per-session key: a draft is only ever valid for its own horario + date. */
export function attendanceDraftKey(horarioId: number, fecha: string): string {
  return `cata_attendance_draft:${horarioId}:${fecha}`;
}

/** id → state, holding only the four real states. */
export type AttendanceDraft = Record<string, EstadoAsistencia>;

function isEstadoAsistencia(value: unknown): value is EstadoAsistencia {
  return typeof value === "string" && (ATTENDANCE_STATES as string[]).includes(value);
}

/**
 * Project the roster onto a draft. Undecided students are simply not in it —
 * see rule 1 above.
 */
export function toAttendanceDraft(students: SessionStudent[]): AttendanceDraft {
  const draft: AttendanceDraft = {};
  for (const student of students) {
    if (student.attendance !== UNMARKED) draft[student.id] = student.attendance;
  }
  return draft;
}

/**
 * Parse a stored draft, keeping only entries that are a real state. Returns
 * `null` for anything that is not a plain object of such entries, so a
 * corrupted or tampered-with value is dropped rather than half-applied.
 */
export function parseAttendanceDraft(raw: string | null): AttendanceDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const draft: AttendanceDraft = {};
  for (const [id, estado] of Object.entries(parsed as Record<string, unknown>)) {
    if (isEstadoAsistencia(estado)) draft[id] = estado;
  }
  return draft;
}

/**
 * Overlay a draft onto a freshly built roster.
 *
 * Only students already ON the roster can be affected, and only by a real
 * state — so this can add decisions the trainer made, never invent students
 * and never un-decide anyone.
 */
export function applyAttendanceDraft(
  students: SessionStudent[],
  draft: AttendanceDraft | null,
): SessionStudent[] {
  if (!draft) return students;
  return students.map((student) => {
    const drafted = draft[student.id];
    return drafted ? { ...student, attendance: drafted } : student;
  });
}

/**
 * Persist the draft. Storage can be unavailable (private browsing, quota,
 * SSR) — losing draft persistence must never take the roll call down with it.
 */
export function saveAttendanceDraft(key: string, students: SessionStudent[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(key, JSON.stringify(toAttendanceDraft(students)));
  } catch {
    // Best-effort: the wizard works exactly as before without it.
  }
}

/** Read a stored draft, or `null` when there is none / storage is unavailable. */
export function loadAttendanceDraft(key: string): AttendanceDraft | null {
  if (typeof window === "undefined") return null;
  try {
    return parseAttendanceDraft(window.sessionStorage?.getItem(key) ?? null);
  } catch {
    return null;
  }
}

/** Drop the draft — called once the session is actually filed. */
export function clearAttendanceDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(key);
  } catch {
    // Ignore.
  }
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
