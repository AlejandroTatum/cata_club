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
 * The countdown line. Says "En curso" for a session already running, counts
 * plain minutes under an hour, and switches to hours beyond that — "En 137
 * minutos" is a number nobody converts in their head at courtside.
 */
export function formatSessionCountdown(minutesAway: number): string {
  if (minutesAway <= 0) return "En curso";
  if (minutesAway === 1) return "En 1 minuto";
  if (minutesAway < 60) return `En ${minutesAway} minutos`;
  const hours = Math.floor(minutesAway / 60);
  const minutes = minutesAway % 60;
  const hourPart = hours === 1 ? "1 hora" : `${hours} horas`;
  return minutes === 0 ? `En ${hourPart}` : `En ${hourPart} y ${minutes} min`;
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
  /** Who actually filed it — can differ from the horario's titular trainer. */
  registradoPor: string;
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
 * Group records into sessions — one per (fecha, horario) pair — most recent
 * first.
 *
 * Grouping by SESSION rather than by student is the whole point of
 * `21-entrenador-historial.html`: "el entrenador no busca «qué hizo Ana el
 * 14»; busca «la lista del lunes pasado»".
 */
export function groupRecordsBySession(records: AttendanceRecord[]): SessionSummary[] {
  const bySession = new Map<string, SessionSummary>();

  for (const record of records) {
    const key = `${record.fecha}|${record.horario}`;
    let session = bySession.get(key);
    if (!session) {
      session = {
        fecha: record.fecha,
        horario: record.horario,
        registradoPor: record.entrenador,
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

/** The most recent session in the set, or `null` when there is none. */
export function summarizeLastSession(records: AttendanceRecord[]): SessionSummary | null {
  return groupRecordsBySession(records)[0] ?? null;
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

/**
 * The message the trainer sends the club about an accumulating absence.
 *
 * There is NO backend endpoint for "notify the club" — the assistant's
 * WhatsApp hand-off is the only real channel — so the button pre-fills this
 * text rather than pretending to file a report.
 */
export function buildAbsenceNotice(alert: AbsenceAlert): string {
  return `Hola, quiero avisar que ${alert.estudiante} suma ${formatAbsenceCount(
    alert.ausencias,
  )} este mes.`;
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
