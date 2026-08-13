/**
 * Pure helpers for the trainer's "Mi día" screen
 * (`docs/ux/prototipos/19-entrenador.html`).
 *
 * The screen has ONE job: get the trainer to the next roll call. Everything
 * here exists to answer four questions from data the backend actually
 * returns — when is the next session, what comes after it, how did the last
 * list go, and is anyone piling up absences.
 *
 * No React, no fetching: `page.tsx` supplies the already-fetched
 * `TrainingSchedule[]` / `AttendanceRecord[]` and renders what these return.
 *
 * ## What is deliberately NOT here
 *
 * No level. `19-entrenador.html` still prints "Nivel 9" beside the session,
 * but "no level information in the trainer's surfaces" is a settled product
 * decision, so no helper below derives, formats or returns one — a level that
 * cannot be built is a level that cannot leak back in.
 */

import type { EstadoAsistencia } from "@/types/domain";
import { buildDateRange, type DateRange } from "@/lib/club-date";
import type {
  AttendanceRecord,
  TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { buildWizardQuery } from "@/app/trainer/attendance/attendance-utils";
import type { AlumnoHorario } from "@/services/api";

// ---------------------------------------------------------------------------
// Clock helpers
// ---------------------------------------------------------------------------

/**
 * Minutes since midnight for an "HH:mm" (or "HH:mm:ss") string, or `null` if
 * it is not a time at all. Defensive because `horaInicio` arrives as a string
 * from the API and one malformed row must not blank the whole hero.
 */
export function parseHoraToMinutes(hora: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(hora.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutes since midnight for a Date, in LOCAL time (the club's own clock). */
export function minutesSinceMidnight(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

// ---------------------------------------------------------------------------
// Today's sessions
// ---------------------------------------------------------------------------

export interface TodaySessions {
  /**
   * The session the hero is about: the first one today that has not finished
   * yet. `null` once the day's last session is over — the hero then has
   * nothing honest to promise.
   */
  next: TrainingSchedule | null;
  /** Everything after `next`, in order — the "Después: 16:00 · 17:00" line. */
  later: TrainingSchedule[];
}

/**
 * Split today's schedules into the one the trainer is heading to and the ones
 * that follow.
 *
 * "Next" is the first session whose END is still ahead, not whose START is —
 * a trainer opening the panel five minutes into a session is heading to THAT
 * session, not skipping it.
 */
export function selectTodaySessions(
  todaySchedules: TrainingSchedule[],
  now: Date = new Date(),
): TodaySessions {
  const nowMinutes = minutesSinceMidnight(now);
  const ordered = [...todaySchedules].sort(
    (a, b) => (parseHoraToMinutes(a.horaInicio) ?? 0) - (parseHoraToMinutes(b.horaInicio) ?? 0),
  );
  const nextIndex = ordered.findIndex((schedule) => {
    const end = parseHoraToMinutes(schedule.horaFin);
    return end === null || end > nowMinutes;
  });
  if (nextIndex === -1) return { next: null, later: [] };
  return { next: ordered[nextIndex], later: ordered.slice(nextIndex + 1) };
}

/**
 * Minutes until a session starts. Negative once it has started — the caller
 * turns that into "En curso" rather than counting backwards.
 */
export function minutesUntilStart(schedule: TrainingSchedule, now: Date = new Date()): number {
  const start = parseHoraToMinutes(schedule.horaInicio);
  if (start === null) return 0;
  return start - minutesSinceMidnight(now);
}

/**
 * "12 estudiantes inscritos" — or the singular, or nothing at all while the
 * roster count is still unknown.
 *
 * The wording is "inscritos", not "esperan": the count comes from
 * `AlumnoHorario` rows (who is ENROLLED in this horario), and nothing in
 * `HorarioResponseDTO` says who actually turned up. `19-entrenador.html`'s own
 * note makes the same correction for the same reason.
 */
export function formatEnrolledCount(count: number | null): string | null {
  if (count === null) return null;
  return count === 1 ? "1 estudiante inscrito" : `${count} estudiantes inscritos`;
}

// ---------------------------------------------------------------------------
// "Última lista"
// ---------------------------------------------------------------------------

export interface SessionSummary {
  /** "YYYY-MM-DD" of the session. */
  fecha: string;
  /** The horario descriptor as the API renders it, e.g. "Lunes 15:00 — 16:00". */
  horario: string;
  /** The horario's raw id. With `fecha`, this is the session's address —
   *  everything the roll call needs to be reopened on exactly this list. */
  horarioId: number;
  counts: Record<EstadoAsistencia, number>;
  total: number;
}

/** The time-of-day inside a horario label, used only for ordering. */
function horarioStartMinutes(horario: string): number {
  const match = /(\d{1,2}:\d{2})/.exec(horario);
  return match ? (parseHoraToMinutes(match[1]) ?? 0) : 0;
}

function emptyCounts(): Record<EstadoAsistencia, number> {
  return { present: 0, absent: 0, late: 0, justified: 0 };
}

/**
 * Group records into sessions — one per (fecha, horarioId) pair — most recent
 * first.
 *
 * Grouping by SESSION rather than by student is the whole point of
 * `21-entrenador-historial.html`: "el entrenador no busca «qué hizo Ana el
 * 14»; busca «la lista del lunes pasado»".
 *
 * The key is the horario's ID, not its label. Nothing in the schema stops two
 * Horario rows from sharing a day and a pair of times, and on the label those
 * two sessions would collapse into one row — with one set of counts covering
 * both, and one "Corregir" pointing at whichever id happened to arrive first.
 */
export function groupRecordsBySession(records: AttendanceRecord[]): SessionSummary[] {
  const bySession = new Map<string, SessionSummary>();

  for (const record of records) {
    const key = `${record.fecha}|${record.horarioId}`;
    let session = bySession.get(key);
    if (!session) {
      session = {
        fecha: record.fecha,
        horario: record.horario,
        horarioId: record.horarioId,
        counts: emptyCounts(),
        total: 0,
      };
      bySession.set(key, session);
    }
    if (record.estado in session.counts) {
      session.counts[record.estado] += 1;
      session.total += 1;
    }
  }

  return [...bySession.values()].sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    return horarioStartMinutes(b.horario) - horarioStartMinutes(a.horario);
  });
}

// ---------------------------------------------------------------------------
// Accumulated absences
// ---------------------------------------------------------------------------

/**
 * Two absences in the same month is the point where a one-off becomes a
 * pattern worth telling the club about. One is an event; flagging it would
 * make the panel cry wolf every week.
 *
 * This is a product default, not a fact from the backend — the club may want
 * its own number.
 */
export const ABSENCE_ALERT_THRESHOLD = 2;

export interface AbsenceAlert {
  estudiante: string;
  ausencias: number;
}

/**
 * The student with the most absences in the given records, when that count
 * reaches the alert threshold. Ties break alphabetically so the panel does not
 * reshuffle between refreshes for no reason.
 *
 * Only `absent` counts — a justified absence is precisely the case the club
 * has already been told about.
 */
export function findAbsenceAlert(records: AttendanceRecord[]): AbsenceAlert | null {
  const byStudent = new Map<string, number>();
  for (const record of records) {
    if (record.estado !== "absent") continue;
    byStudent.set(record.estudiante, (byStudent.get(record.estudiante) ?? 0) + 1);
  }

  let worst: AbsenceAlert | null = null;
  for (const [estudiante, ausencias] of byStudent) {
    if (
      worst === null ||
      ausencias > worst.ausencias ||
      (ausencias === worst.ausencias && estudiante < worst.estudiante)
    ) {
      worst = { estudiante, ausencias };
    }
  }

  return worst && worst.ausencias >= ABSENCE_ALERT_THRESHOLD ? worst : null;
}

/** "3 ausencias" / "2 ausencias" / "1 ausencia". */
export function formatAbsenceCount(ausencias: number): string {
  return ausencias === 1 ? "1 ausencia" : `${ausencias} ausencias`;
}

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

/**
 * First day of the club month containing `instant`, through that same club day.
 *
 * A thin alias over the shared `this_month` preset — kept because the trainer
 * dashboard reads better calling it by name, but deliberately NOT a second
 * implementation of the rule.
 *
 * `instant` is an INSTANT (`new Date()`), not a calendar date: it is resolved
 * through the club's time zone before the month is read off it. Passing a
 * noon-anchored calendar `Date` — the shape `clubToday()` returns and that
 * other callers in this codebase build — would silently shift the range for
 * any device far enough from Ecuador. See `@/lib/club-date` for the
 * instant-vs-calendar-date split this name is honouring.
 */
export function monthToDateRange(instant: Date = new Date()): DateRange {
  return buildDateRange("this_month", instant);
}

// ---------------------------------------------------------------------------
// The immediate-session card (issue #211)
//
// The card's big number follows whichever question is still live: "how long
// until" before the session starts, "which one" once it has (the hour is a
// session's identifier — `19-entrenador.html`'s successor,
// `31-entrenador-dashboard-alternativas.html`, names this directly). "done"
// carries no schedule and no href at all — a state with nothing to point at
// must not be able to grow one by accident.
// ---------------------------------------------------------------------------

export interface SessionCardNext {
  kind: "next";
  schedule: TrainingSchedule;
  minutesAway: number;
  href: string;
  /** Everything still to come today, after `schedule` — see `selectTodaySessions`. */
  later: TrainingSchedule[];
}

export interface SessionCardLive {
  kind: "live";
  schedule: TrainingSchedule;
  minutesElapsed: number;
  href: string;
  /** Everything still to come today, after `schedule` — see `selectTodaySessions`. */
  later: TrainingSchedule[];
}

export interface SessionCardDone {
  kind: "done";
}

/** `null` stands for the three states that never render a card: rest day, loading, error. */
export type SessionCardState = SessionCardNext | SessionCardLive | SessionCardDone | null;

/**
 * Derive the immediate-session card's state from today's schedules.
 *
 * `fecha` is deliberately never passed to `buildWizardQuery`: this card is
 * always about TODAY, which is the wizard's own default and needs no address
 * (`attendance-utils.ts`'s own note on `fecha` being optional).
 */
export function buildSessionCardState(
  todaySchedules: TrainingSchedule[],
  now: Date = new Date(),
): SessionCardState {
  if (todaySchedules.length === 0) return null;

  const { next, later } = selectTodaySessions(todaySchedules, now);
  if (!next) return { kind: "done" };

  const href = `/trainer/attendance${buildWizardQuery(next.id, null, "mark-attendance")}`;
  const minutesAway = minutesUntilStart(next, now);

  return minutesAway > 0
    ? { kind: "next", schedule: next, minutesAway, href, later }
    : { kind: "live", schedule: next, minutesElapsed: -minutesAway, href, later };
}

/** "Hace N minutos" for the live state's support line. Never "hace 0 minutos". */
export function formatElapsedMinutes(minutes: number): string {
  if (minutes <= 0) return "Recién empezó";
  return minutes === 1 ? "Hace 1 minuto" : `Hace ${minutes} minutos`;
}

/**
 * Enrolled-count-by-horario map for TODAY's schedules, built from the club's
 * one-call roster (`fetchRosterDeTodosLosHorarios`) instead of one
 * `fetchAlumnosPorHorario` per card — the same N+1-avoiding move `/groups`
 * already made (TRA-7), now paying for the hero session AND every session
 * still to come today in a single fetch.
 *
 * Every schedule in `todaySchedules` gets an entry, even 0 — a genuinely
 * empty class still counts as a known "0 estudiantes inscritos", not the
 * missing-data blank `formatEnrolledCount(null)` renders.
 */
export function buildEnrolledCountsByHorario(
  todaySchedules: TrainingSchedule[],
  roster: AlumnoHorario[],
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const schedule of todaySchedules) counts[schedule.id] = 0;
  for (const alumno of roster) {
    if (alumno.horarioId in counts) counts[alumno.horarioId] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// "Últimas listas" proportional bar (issue #211)
//
// Color is reserved for badges and pills — four loose colored counts per row
// compete with the page's own red CTA, so the composition renders as one
// proportional bar instead. The bar is decorative on its own, so every number
// still has to reach an accessibility tree: the `aria-label` built below
// states all four counts and the total every time.
// ---------------------------------------------------------------------------

/** Reading order for the four attendance states — best news first, as on every other screen. */
export const STATE_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

export interface SessionBarSegment {
  estado: EstadoAsistencia;
  count: number;
  /** Share of `total`, as a raw (unrounded) 0-100 percentage — a CSS width, not a displayed figure. */
  widthPercent: number;
}

/** One segment per state, in `STATE_ORDER`. Every width is 0 when `total` is 0, never NaN. */
export function buildSessionBarSegments(
  counts: Record<EstadoAsistencia, number>,
  total: number,
): SessionBarSegment[] {
  return STATE_ORDER.map((estado) => ({
    estado,
    count: counts[estado],
    widthPercent: total > 0 ? (counts[estado] / total) * 100 : 0,
  }));
}

/** Singular/plural noun pair for each state, used only by `buildSessionBarAriaLabel`. */
const BAR_STATE_NOUNS: Record<EstadoAsistencia, [singular: string, plural: string]> = {
  present: ["presente", "presentes"],
  late: ["tardanza", "tardanzas"],
  justified: ["justificado", "justificados"],
  absent: ["ausente", "ausentes"],
};

function pluralizedCount(count: number, [singular, plural]: [string, string]): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The bar's `role="img"` `aria-label`: every count, in `STATE_ORDER`, plus
 * the total — the one place the bar's information reaches a screen reader,
 * since the bar itself carries no other text.
 */
export function buildSessionBarAriaLabel(
  counts: Record<EstadoAsistencia, number>,
  total: number,
): string {
  const parts = STATE_ORDER.map((estado) => pluralizedCount(counts[estado], BAR_STATE_NOUNS[estado]));
  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(", ")} y ${last} sobre ${total} registros`;
}
