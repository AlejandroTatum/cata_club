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

import type { EstadoAsistencia } from "@/types/domain";
import type { AlumnoHorario, AttendanceStudentMark } from "@/services/api";
import type { AttendanceRecord } from "@/app/attendance/attendance-utils";
import { calendarIsoDate, clubToday } from "@/lib/club-date";

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
  /**
   * The real `Asistencia` row id for this student's session, when one
   * exists — `null`/absent when the student has no filed record yet (a
   * partially-failed batch can leave some rows without one). This is what a
   * correction (`PATCH /asistencias/{id}/corregir`, issue #389) addresses;
   * `id` above is only the persona id and was never enough to reach it.
   * Threaded from `AttendanceRecord.id` in `buildRosterFromAlumnoHorarios`.
   */
  asistenciaId?: number | null;
  /** The row's current justificativo, threaded straight from the server so
   *  the correction form pre-fills instead of guessing (issue #389). */
  justificativo?: string | null;
  /** Whether `justificativo` was accepted, when one exists. */
  estadoJustificativo?: boolean | null;
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
 * Where ArrowRight/ArrowLeft (or ArrowDown/ArrowUp) move the four-state
 * radiogroup, following `ATTENDANCE_STATES`' own left-to-right layout order
 * rather than `nextAttendanceState`'s tap-accelerator order — the arrow keys
 * walk the row the eye sees, wrapping at both ends (issue #312 / hallazgo
 * #26: the group used to have no arrow-key behaviour at all, so it cost 5
 * Tab stops per student instead of the ARIA radiogroup pattern's Tab +
 * arrow).
 */
export function arrowAttendanceState(
  current: EstadoAsistencia,
  key: "ArrowRight" | "ArrowDown" | "ArrowLeft" | "ArrowUp",
): EstadoAsistencia {
  const delta = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
  const idx = ATTENDANCE_STATES.indexOf(current);
  const from = idx === -1 ? 0 : idx;
  const next = (from + delta + ATTENDANCE_STATES.length) % ATTENDANCE_STATES.length;
  return ATTENDANCE_STATES[next];
}

/**
 * The order tapping a student's row walks through
 * (`docs/archive/prototypes/prototipos/20-tomar-lista.html`):
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
 * Post-submission counts by state, for the confirmation receipt (issue
 * #213). Replaces `buildAttendanceSummary`, which rendered the result as one
 * joined sentence — the receipt needs the four counts as data, one per row of
 * a grid plus a proportional bar, not pre-formatted text.
 *
 * Counts what was SAVED, not what the trainer marked (decision 2): pass
 * `result.failed`'s persona ids as `failedPersonaIds` and this excludes those
 * students from the tally, because the receipt describes what got filed, not
 * the trainer's intent. Every one of the four states is always a key of the
 * returned record, even at zero — the caller must render it anyway (decision
 * 1): a missing row would read as "not reported" instead of "reported as
 * zero".
 */
export function buildAttendanceReceipt(
  students: SessionStudent[],
  failedPersonaIds: number[] = [],
): Record<EstadoAsistencia, number> {
  const failedIds = new Set(failedPersonaIds.map(String));
  const saved = students.filter((s) => !failedIds.has(s.id));
  return {
    present: countByState(saved, "present"),
    absent: countByState(saved, "absent"),
    late: countByState(saved, "late"),
    justified: countByState(saved, "justified"),
  };
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
/**
 * True once at least one row's `attendance` differs from `serverRoster` — the
 * snapshot the roster carried the moment it left the server, taken BEFORE any
 * draft overlay or trainer edit (see `openRoster`, page.tsx).
 *
 * `reviewed`/`reviewedCount` cannot answer "is there something unsaved":
 * a row already comes back reviewed when the server sent a recorded `estado`
 * for it (`buildRosterFromAlumnoHorarios` above), which is exactly what a
 * read-only, already-registered session does for EVERY row without the
 * trainer touching anything (issue #335). This diffs against the server
 * snapshot instead, so only edits made in THIS visit — a live tap or a
 * restored draft, both funneled through `commitStudents` in page.tsx — ever
 * count as "unsaved".
 *
 * An empty roster has nothing to compare and is never "unsaved" — this
 * matters for `handleReset`, which clears `students` back to `[]` without
 * also clearing the stale server snapshot still sitting in the ref.
 */
export function hasUnsavedAttendanceEdits(
  current: SessionStudent[],
  serverRoster: SessionStudent[],
): boolean {
  if (current.length === 0) return false;
  const serverAttendanceById = new Map(serverRoster.map((s) => [s.id, s.attendance]));
  return current.some((s) => s.attendance !== serverAttendanceById.get(s.id));
}

/**
 * Force every row to `reviewed: true` — for a session that is already
 * closed (`existingRecords.length > 0` in `openRoster`, issue #485).
 *
 * `buildRosterFromAlumnoHorarios` maps `reviewed` per row, against the
 * horario's CURRENT membership (`fetchAlumnosPorHorario`), which can grow
 * AFTER a session closes: a student enrolled later has no record for that
 * past date, so that row alone comes back `reviewed: false`. A closed
 * session cannot gain a new pending review — nothing can be marked from
 * here (issue #389) — so counting that row against `unreviewedCount` made an
 * already-closed list keep reporting a nonzero "sin revisar" that no real,
 * pending alumno backed.
 */
export function markRosterClosed(students: SessionStudent[]): SessionStudent[] {
  return students.map((s) => (s.reviewed ? s : { ...s, reviewed: true }));
}

export function buildRosterFromAlumnoHorarios(
  items: AlumnoHorario[],
  existingRecords: AttendanceRecord[] = [],
): SessionStudent[] {
  const recordByPersonaId = new Map(existingRecords.map((r) => [r.personaId, r]));
  return items.map((item) => {
    const record = recordByPersonaId.get(item.personaId);
    return {
      id: String(item.personaId),
      name: item.personaNombreCompleto,
      attendance: (record?.estado ?? DEFAULT_ATTENDANCE) as WizardAttendance,
      reviewed: record !== undefined,
      // `record.id` is the real Asistencia row id (`String(asistencia.id)`,
      // see `buildAttendanceRecord`) — NOT `item.personaId`, which is what
      // `id` above already holds. A student with no filed record yet has
      // nothing to correct.
      asistenciaId: record ? Number(record.id) : null,
      justificativo: record?.justificativo ?? null,
      estadoJustificativo: record?.estadoJustificativo ?? null,
    };
  });
}

/**
 * Tally a flat list of attendance records by their horario.
 *
 * Feeds step 1's "lista tomada" indicator (issue #310 / #22, widened to every
 * day by #483): pair with `weekWindowStartIso()` / `clubIsoDate()` from
 * `club-date.ts` for a `fetchAttendanceRecords` call that covers every day
 * "Ver todos los días" can show, and each horario's single weekly occurrence
 * lands in the window exactly once, so keying by `horarioId` alone (no date)
 * stays unambiguous.
 */
export function countRecordsByHorario(records: AttendanceRecord[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const record of records) {
    counts.set(record.horarioId, (counts.get(record.horarioId) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Correction window (issue #389, slice 4b)
// ---------------------------------------------------------------------------

/**
 * Corrections only reach back this many days — mirrors the backend's
 * `LIMITE_CORRECCION_ASISTENCIA_DIAS`
 * (`backend/app/servicios_negocio/asistencia_servicio.py`) and the same
 * 30-day concept `trainer/attendance/history/page.tsx` already names locally
 * as `LIMITE_CORRECCION_DIAS` for its own deep-link gate.
 */
export const CORRECTION_WINDOW_DIAS = 30;

/**
 * Whether a session dated `fecha` ("YYYY-MM-DD") is still inside the
 * correction window, computed client-side so a row's "Corregir" can be
 * disabled without a round trip — the backend re-checks this itself and is
 * the real gate; this only avoids offering a button the API is always going
 * to refuse.
 *
 * Compared lexicographically against the cutoff, same as
 * `history/page.tsx`'s `corteCorreccion` — both sides are "YYYY-MM-DD".
 */
export function isWithinCorrectionWindow(fecha: string, today: Date = clubToday()): boolean {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - CORRECTION_WINDOW_DIAS);
  return fecha >= calendarIsoDate(cutoff);
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
//
// `fecha` joins them for the trainer history's "Corregir" (#95), and it is
// OPTIONAL on purpose. Today is what the wizard defaults to and needs no
// address; a correction to a past session is the case the URL has to carry,
// because it is the only one that cannot be re-derived from the clock. So the
// ordinary "pasar lista" flow keeps the exact URL it always had, and only a
// deep link pays for the extra parameter.
// ---------------------------------------------------------------------------

const HORARIO_QUERY_KEY = "horario";
const FECHA_QUERY_KEY = "fecha";
const STEP_QUERY_KEY = "paso";

/**
 * A "YYYY-MM-DD" that is also a real day.
 *
 * The shape check alone would let `2026-02-31` through, and this date decides
 * which session gets FILED — a batch landing on a day that does not exist is
 * worse than falling back to today, which is at least a day the trainer can
 * see on screen. Compared component-wise because `Date` rolls overflow
 * forward silently (Feb 31 becomes Mar 3) instead of rejecting it.
 */
function parseIsoDateParam(raw: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw ?? "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return raw;
}

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
  /** The session's day, or `null` for the wizard's default of today. */
  fecha: string | null;
  step: WizardStep;
}

/** Read the wizard's position out of a query string (`window.location.search`). */
export function parseWizardQuery(search: string): WizardLocation {
  const params = new URLSearchParams(search);
  const rawHorarioId = Number(params.get(HORARIO_QUERY_KEY));
  const horarioId =
    Number.isInteger(rawHorarioId) && rawHorarioId > 0 ? rawHorarioId : null;
  const step = STEP_BY_QUERY_VALUE[params.get(STEP_QUERY_KEY) ?? ""] ?? "select-session";
  // A date belongs to a session, and without a horario there is no session for
  // it to date — it falls back to the picker along with everything else.
  if (horarioId === null) return { horarioId: null, fecha: null, step: "select-session" };
  return { horarioId, fecha: parseIsoDateParam(params.get(FECHA_QUERY_KEY)), step };
}

/** The query string for a position, `""` at the start of the flow. */
export function buildWizardQuery(
  horarioId: number | null,
  fecha: string | null,
  step: WizardStep,
): string {
  const params = new URLSearchParams();
  if (horarioId !== null) params.set(HORARIO_QUERY_KEY, String(horarioId));
  if (horarioId !== null && fecha !== null) params.set(FECHA_QUERY_KEY, fecha);
  const paso = STEP_QUERY_VALUE[step];
  if (paso) params.set(STEP_QUERY_KEY, paso);
  const query = params.toString();
  return query ? `?${query}` : "";
}

// `resolveEntrenadorId`/`resolveDisplayTrainerName` (admin-on-behalf-of-
// trainer resolution, PR8) were removed with the trainer–schedule relation
// (issue #13): attendance no longer records who taught the session, so there
// is no `entrenadorId` to resolve.
