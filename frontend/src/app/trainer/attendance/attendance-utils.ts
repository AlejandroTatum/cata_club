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
 * Frontend-only sentinel for "no state at all".
 *
 * The backend contract (`AttendanceStudentMark.estado`) only accepts the four
 * real `EstadoAsistencia` values, so this value is NEVER submitted:
 * `toAttendanceMarks` strips it, the wizard refuses to submit while any row
 * carries it, and neither the roster builder nor the draft can produce it.
 *
 * It is no longer the roster's initial state (see `DEFAULT_ATTENDANCE`), but it
 * stays a real, guarded value: it is what a corrupted draft, a future code path
 * or a hand-edited storage entry would have to become, and every one of those
 * doors stays shut.
 */
export const UNMARKED = "unmarked";

/**
 * What a roster row starts on when nobody has decided anything about it.
 *
 * The trainer asked for this: a session is overwhelmingly "everyone showed
 * up", and starting from the answer instead of from nothing turns a 40-tap
 * chore into a handful of corrections.
 *
 * The risk that used to justify starting from `UNMARKED` did not disappear,
 * it INVERTED: a distracted trainer can now file students as present without
 * ever looking at them. So the default is separated from the decision —
 * `reviewed` records whether a human actually touched the row, the roll call
 * keeps a full-roster count of the untouched ones, and the confirmation step
 * says so out loud instead of reporting "45 presentes" either way.
 */
export const DEFAULT_ATTENDANCE: EstadoAsistencia = "present";

/** Attendance value a roster row can hold inside the wizard, before submission. */
export type WizardAttendance = EstadoAsistencia | typeof UNMARKED;

/** The three stops of the roll-call wizard, in order. */
export type WizardStep = "select-session" | "mark-attendance" | "confirm";

export const WIZARD_STEP_ORDER: WizardStep[] = [
  "select-session",
  "mark-attendance",
  "confirm",
];

export interface SessionStudent {
  id: string;
  name: string;
  attendance: WizardAttendance;
  /**
   * True once a HUMAN set this row's state — a tap on the fiche, one of the
   * four controls, "Marcar restantes presentes", a record already saved for
   * this session, or a restored draft entry.
   *
   * Absent/false means the row still carries `DEFAULT_ATTENDANCE` because
   * nobody looked at it. Optional so that a `SessionStudent` literal without
   * it reads as "not reviewed", which is the safe interpretation.
   */
  reviewed?: boolean;
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
 * What tapping a student's fiche does.
 *
 * The first tap on an UNREVIEWED row confirms the default instead of moving
 * off it. The state shown is already "Presente", so a trainer tapping the row
 * of a student who is standing right there means "yes, that one" — advancing
 * them to "Tardanza" for saying so would be the opposite of what they did, and
 * would make confirming a present student cost four taps.
 *
 * Once the row is reviewed, tapping cycles as before. `UNMARKED` still cycles
 * straight away: there is nothing there to confirm.
 */
export function tapWizardAttendance(student: SessionStudent): EstadoAsistencia {
  if (!isReviewed(student) && student.attendance !== UNMARKED) return student.attendance;
  return cycleWizardAttendance(student.attendance);
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
 * Count the rows still carrying the `UNMARKED` sentinel.
 *
 * With `DEFAULT_ATTENDANCE` this is 0 on every path the wizard can produce —
 * which is the point. It stays wired to the submit guard as the invariant
 * check that the sentinel never reaches the API, not as a workflow gate.
 * For "how many students has nobody looked at", use `countUnreviewed`.
 */
export function countUnmarked(students: SessionStudent[]): number {
  return students.filter((s) => s.attendance === UNMARKED).length;
}

/** Did a human set this row's state, or is it still the default? */
export function isReviewed(student: SessionStudent): boolean {
  return student.reviewed === true;
}

/**
 * Count how many students NOBODY has looked at — the rows still sitting on
 * `DEFAULT_ATTENDANCE` because no human touched them.
 *
 * Callers must pass the FULL roster, not the current page: the wizard
 * paginates at 10 and filters by name, so a page- or filter-scoped count
 * would report "0 sin revisar" while a whole second page of students was
 * about to be filed present sight unseen — the same silent-data-loss shape
 * the old `absent` default had, pointing the other way.
 */
export function countUnreviewed(students: SessionStudent[]): number {
  return students.filter((s) => !isReviewed(s)).length;
}

/**
 * Bulk action for the common case (near-full attendance): the trainer states,
 * in one tap, that everyone they have not touched is present.
 *
 * That is a decision, so those rows come back REVIEWED — the button is how a
 * trainer says "I looked, the rest are here", and the confirmation step must
 * stop flagging them afterwards. Rows the trainer already decided are left
 * exactly as they are. Returns a new array — never mutates the input.
 */
export function markRemainingPresent(students: SessionStudent[]): SessionStudent[] {
  return students.map((s) =>
    isReviewed(s) ? s : { ...s, attendance: DEFAULT_ATTENDANCE, reviewed: true },
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
 * (`GET /groups/horarios/:id/alumnos`), starting every student on
 * `DEFAULT_ATTENDANCE` and NOT reviewed: the value is a proposal, and the
 * roll call keeps saying so until a human confirms it.
 *
 * `existingRecords` is optional — pass today's `AttendanceRecord[]` for this
 * same horario (see `fetchAttendanceRecords`) to pre-select each student's
 * already-registered `estado`. A saved record IS a decision somebody made for
 * this session, so those rows come back reviewed. This is what makes
 * re-opening the wizard for a session that already has recorded attendance
 * show the existing marks (and, combined with the backend upsert in
 * `registrar_asistencia`, resubmitting updates those rows instead of creating
 * duplicates).
 */
export function buildRosterFromAlumnoHorarios(
  items: AlumnoHorario[],
  existingRecords: AttendanceRecord[] = [],
): SessionStudent[] {
  const estadoByPersonaId = new Map(existingRecords.map((r) => [r.personaId, r.estado]));
  return items.map((item) => {
    const recorded = estadoByPersonaId.get(item.personaId);
    return {
      id: String(item.personaId),
      name: item.personaNombreCompleto,
      attendance: (recorded ?? DEFAULT_ATTENDANCE) as WizardAttendance,
      reviewed: recorded !== undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Draft persistence
//
// The audit's finding: a phone call mid-roll-call loses the whole session,
// because nothing survives the component unmounting. The draft below closes
// that WITHOUT weakening the `UNMARKED` guarantee, and the rules are what make
// that true:
//
//   1. Only the four REAL states are ever written or read, and only for rows a
//      human REVIEWED. A row still sitting on `DEFAULT_ATTENDANCE` is not a
//      decision, so persisting it would let a page refresh quietly promote
//      "nobody looked" into "confirmed present" — the draft would be laundering
//      the exact signal the confirmation step exists to show.
//   2. The key includes the horario AND the date, so yesterday's draft can
//      never be replayed onto today's session.
//   3. Restoring only ever narrows: a student absent from the draft keeps
//      whatever the roster gave them, still unreviewed.
//   4. Anything malformed is discarded wholesale rather than partially
//      trusted.
//
// `sessionStorage`, not `localStorage`: a draft is scoped to the tab the
// trainer is standing there with, and must not outlive it on a shared device.
// ---------------------------------------------------------------------------

const DRAFT_KEY_PREFIX = "cata_attendance_draft:";

/** Per-session key: a draft is only ever valid for its own horario + date. */
export function attendanceDraftKey(horarioId: number, fecha: string): string {
  return `${DRAFT_KEY_PREFIX}${horarioId}:${fecha}`;
}

/** id → state, holding only the four real states. */
export type AttendanceDraft = Record<string, EstadoAsistencia>;

/** A draft found in storage, as the "resume" offer needs to describe it. */
export interface StoredAttendanceDraft {
  key: string;
  horarioId: number;
  fecha: string;
  /** How many rows a human actually decided — never the whole roster. */
  markCount: number;
}

function isEstadoAsistencia(value: unknown): value is EstadoAsistencia {
  return typeof value === "string" && (ATTENDANCE_STATES as string[]).includes(value);
}

/**
 * Project the roster onto a draft. Only rows a human reviewed are in it —
 * see rule 1 above.
 */
export function toAttendanceDraft(students: SessionStudent[]): AttendanceDraft {
  const draft: AttendanceDraft = {};
  for (const student of students) {
    if (isReviewed(student) && student.attendance !== UNMARKED) {
      draft[student.id] = student.attendance;
    }
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
 * state — so this can restore decisions the trainer made, never invent
 * students and never un-decide anyone. A restored entry comes back REVIEWED:
 * it only got into the draft because a human made it.
 */
export function applyAttendanceDraft(
  students: SessionStudent[],
  draft: AttendanceDraft | null,
): SessionStudent[] {
  if (!draft) return students;
  return students.map((student) => {
    const drafted = draft[student.id];
    return drafted ? { ...student, attendance: drafted, reviewed: true } : student;
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

/**
 * Every draft currently stored for `fecha`, newest-first by nothing in
 * particular — there is normally exactly one.
 *
 * The draft IS the pointer: rather than writing a second "where was I" record
 * that could disagree with it, the roll call reads back the drafts it already
 * wrote. Entries for another date are skipped (rule 2 — a draft is only ever
 * valid for its own session) and empty drafts are skipped too, because a draft
 * with no reviewed row is nothing to offer to resume.
 */
export function listAttendanceDrafts(fecha: string): StoredAttendanceDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const store = window.sessionStorage;
    if (!store) return [];
    const found: StoredAttendanceDraft[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(DRAFT_KEY_PREFIX)) continue;
      const [rawHorarioId, rawFecha] = key.slice(DRAFT_KEY_PREFIX.length).split(":");
      if (rawFecha !== fecha) continue;
      const horarioId = Number(rawHorarioId);
      if (!Number.isInteger(horarioId)) continue;
      const draft = parseAttendanceDraft(store.getItem(key));
      const markCount = draft ? Object.keys(draft).length : 0;
      if (markCount === 0) continue;
      found.push({ key, horarioId, fecha: rawFecha, markCount });
    }
    return found;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The wizard's address
//
// The three steps used to live only in React state, so the browser's Back
// button skipped the whole flow and threw the trainer out to /trainer with
// their marks still on screen — the steps were never history entries to begin
// with. Putting the step in the query string makes each one a real entry
// (Back walks the wizard backwards), makes the flow linkable, and lets a
// reload land back on the roll call instead of on "Elija el horario".
//
// A step past the picker is meaningless without the horario it belongs to, so
// the two are parsed together: `?paso=lista` with no (or a junk) `horario`
// resolves to the picker rather than to a roll call for nobody.
// ---------------------------------------------------------------------------

const HORARIO_QUERY_KEY = "horario";
const STEP_QUERY_KEY = "paso";

/** Query value per step — the picker is the bare URL, with no `paso` at all. */
const STEP_QUERY_VALUE: Record<WizardStep, string | null> = {
  "select-session": null,
  "mark-attendance": "lista",
  confirm: "confirmar",
};

const STEP_BY_QUERY_VALUE: Record<string, WizardStep> = {
  lista: "mark-attendance",
  confirmar: "confirm",
};

export interface WizardLocation {
  horarioId: number | null;
  step: WizardStep;
}

/** Read the wizard's position out of a query string (`window.location.search`). */
export function parseWizardQuery(search: string): WizardLocation {
  const params = new URLSearchParams(search);
  const rawHorarioId = Number(params.get(HORARIO_QUERY_KEY));
  const horarioId =
    Number.isInteger(rawHorarioId) && rawHorarioId > 0 ? rawHorarioId : null;
  const step = STEP_BY_QUERY_VALUE[params.get(STEP_QUERY_KEY) ?? ""] ?? "select-session";
  if (horarioId === null) return { horarioId: null, step: "select-session" };
  return { horarioId, step };
}

/** The query string for a position, `""` at the start of the flow. */
export function buildWizardQuery(horarioId: number | null, step: WizardStep): string {
  const params = new URLSearchParams();
  if (horarioId !== null) params.set(HORARIO_QUERY_KEY, String(horarioId));
  const paso = STEP_QUERY_VALUE[step];
  if (paso) params.set(STEP_QUERY_KEY, paso);
  const query = params.toString();
  return query ? `?${query}` : "";
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
