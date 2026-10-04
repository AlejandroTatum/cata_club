/**
 * Pure chart helpers for the "Distribución de Asistencias" donut on the
 * admin Panel de Control. No React dependencies — easy to test.
 *
 * Colors are NOT the badge tokens attendance-utils.ts uses elsewhere
 * (bg-cata-state-ok / red-700 / amber-700 / blue-700) — those fail the
 * dataviz skill's adjacent-pair CVD/normal-vision checks when placed side
 * by side in a chart. This palette (green/yellow/blue/red, in this exact
 * order) is validated: `node validate_palette.js
 * "#008300,#eda100,#2a78d6,#e34948" --mode light --surface "#FFFFFF"` — all
 * checks pass, including --pairs all.
 */

import {
  ATTENDANCE_LABELS,
  type AttendanceDayStats,
  type AttendanceRecord,
} from "@/app/attendance/attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";
import type { PaymentValidationRequest } from "@/services/api";
import { formatCurrency } from "@/lib/format-utils";
import { attendanceRatePercent, countsAsAttended } from "@/lib/attendance-rule";
import { calendarIsoDate, clubIsoDate, clubTimeHHMM, clubToday } from "@/lib/club-date";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { BadgeTone } from "@/components/ui/Badge";
import { toMinutes, type TimelineItem, type TimelineStatus } from "@/components/charts/timeline-layout";

export const ATTENDANCE_STATUS_CHART_COLORS: Record<EstadoAsistencia, string> = {
  present: "#008300",
  late: "#eda100",
  absent: "#e34948",
  // Issue #1373: sick (violet) and competition (teal) join the donut. The
  // four original colors were validated with the dataviz skill's palette
  // validator (adjacent-pair CVD checks); the two additions have NOT been
  // through that validator — flagged for design review rather than silently
  // inheriting the old validation.
  sick: "#b04fc9",
  competition: "#0e8f92",
};

/** Fixed render order — also the validated adjacent-pair order (do not reorder without re-running the validator). */
const ATTENDANCE_STATUS_ORDER: EstadoAsistencia[] = ["present", "late", "sick", "competition", "absent"];

export interface AttendanceStatusSegment {
  estado: EstadoAsistencia;
  label: string;
  value: number;
  /** Rounded 0-100 share of `stats.totalStudents` (the total record count — see buildAttendanceStats). */
  percentage: number;
  color: string;
}

/**
 * One segment per known attendance state, in `ATTENDANCE_STATUS_ORDER`. Always
 * returns all 6 states (even at 0 count) so the legend shows the full picture.
 * Percentage is 0 for every segment when there are no records — never NaN.
 */
export function buildAttendanceStatusSegments(stats: AttendanceDayStats): AttendanceStatusSegment[] {
  const countByEstado: Record<EstadoAsistencia, number> = {
    present: stats.totalPresent,
    late: stats.totalLate,
    // Issue #1373: sick/competition carry their own stats counts — they are
    // never folded into absent (authorized absences, never unexcused).
    sick: stats.totalSick,
    competition: stats.totalCompetition,
    absent: stats.totalAbsent,
  };

  return ATTENDANCE_STATUS_ORDER.map((estado) => {
    const value = countByEstado[estado];
    return {
      estado,
      label: ATTENDANCE_LABELS[estado],
      value,
      percentage: stats.totalStudents > 0 ? Math.round((value / stats.totalStudents) * 100) : 0,
      color: ATTENDANCE_STATUS_CHART_COLORS[estado],
    };
  });
}

/** Visual gap between donut segments, in degrees of arc. */
const GAP_DEGREES = 3;

export interface DonutArc {
  /** SVG `stroke-dasharray`: "<visible length> <remainder>". */
  dashArray: string;
  /** SVG `stroke-dashoffset`. */
  dashOffset: number;
}

/**
 * Compute `stroke-dasharray`/`stroke-dashoffset` pairs for a donut chart's
 * `<circle>` segments, in the same order as `values`.
 *
 * No gap is rendered when only one value is non-zero (a lone 100% segment
 * draws a full, unbroken ring) — gaps only make sense *between* segments.
 * When every value is 0 (no data yet), every arc is fully invisible instead
 * of throwing or rendering NaN.
 */
export function buildDonutArcs(values: number[], circumference: number): DonutArc[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total === 0) {
    return values.map(() => ({ dashArray: `0 ${circumference}`, dashOffset: 0 }));
  }

  const nonZeroCount = values.filter((v) => v > 0).length;
  const gapLength = nonZeroCount > 1 ? (GAP_DEGREES / 360) * circumference : 0;

  let cumulativeOffset = 0;
  return values.map((value) => {
    const rawLength = (value / total) * circumference;
    const visibleLength = value > 0 ? Math.max(rawLength - gapLength, 0) : 0;
    const arc: DonutArc = {
      dashArray: `${visibleLength} ${circumference - visibleLength}`,
      dashOffset: -cumulativeOffset,
    };
    cumulativeOffset += rawLength;
    return arc;
  });
}

// ---------------------------------------------------------------------------
// The "jornada" pulse (Fase 3 — prototype 06)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/**
 * Read a timestamp for ordering, treating a date-only value as local NOON.
 *
 * Attendance records carry a date with no time (`Asistencia.fecha`), payments
 * carry a full instant. Midnight would rank a whole day's sessions above every
 * payment uploaded that same day, and end-of-day would rank them below; noon is
 * the only anchor that does not systematically lie in one direction. Ordering
 * is the ONLY thing this value is used for — it is never rendered.
 */
function toSortableTime(value: string): number | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12).getTime();
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * How many pending payments have been waiting more than a week.
 *
 * This is the hero's second line, and the only reason the hero shows two
 * numbers instead of one: "14 esperan" is a workload, "3 llevan más de una
 * semana" is a reason to start now.
 */
export function countPaymentsWaitingOverAWeek(
  requests: PaymentValidationRequest[],
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - 7 * DAY_MS;
  return requests.filter((r) => {
    if (r.validationStatus !== "pendiente") return false;
    const uploaded = toSortableTime(r.uploadedAt);
    return uploaded !== null && uploaded < cutoff;
  }).length;
}

/** One sparkbar: a 7-day window of attendance and its presence rate. */
export interface AttendanceWeekBar {
  /** "YYYY-MM-DD" of the first day in the window (inclusive). */
  startIso: string;
  total: number;
  /** Presente plus tardanza (`lib/attendance-rule`): the same rule as Asistencias. */
  attended: number;
  /** Rounded 0-100 share of records that count as attendance. 0 when the week is empty. */
  ratePercent: number;
}

export interface FourWeekAttendance {
  /** Oldest window first, so the bars read left to right as time passes. */
  bars: AttendanceWeekBar[];
  total: number;
  attended: number;
  /** Attendance rate across the whole window. 0 when there are no records. */
  ratePercent: number;
}

/**
 * First day (ISO) of the oldest of the trailing N 7-day windows ending today:
 * what the dashboard passes as `fechaInicio`, so it downloads the weeks it
 * draws and not the whole history (PERF-03).
 */
export function attendanceWindowStartIso(weeks: number, today: Date = new Date()): string {
  const clubNow = clubToday(today);
  const endOfToday = new Date(clubNow.getFullYear(), clubNow.getMonth(), clubNow.getDate()).getTime();
  return calendarIsoDate(new Date(endOfToday - ((weeks - 1) * 7 + 6) * DAY_MS));
}

/**
 * Bucket attendance records into the trailing N 7-day windows ending today.
 *
 * Windows, not calendar weeks: the stat says "4 semanas", and a calendar-week
 * bucketing would make the newest bar a partial week that always reads as a
 * collapse. Records outside the window are ignored; records with an unparseable
 * date are dropped rather than assigned to an arbitrary bucket.
 */
export function buildFourWeekAttendance(
  records: AttendanceRecord[],
  today: Date = new Date(),
  weeks = 4,
): FourWeekAttendance {
  // Anchored on the CLUB's today, then read back as calendar dates: the
  // window bounds are days, not instants.
  const clubNow = clubToday(today);
  const endOfToday = new Date(clubNow.getFullYear(), clubNow.getMonth(), clubNow.getDate()).getTime();
  const bars: AttendanceWeekBar[] = Array.from({ length: weeks }, (_, i) => {
    const startOffsetDays = (weeks - 1 - i) * 7 + 6;
    return {
      startIso: calendarIsoDate(new Date(endOfToday - startOffsetDays * DAY_MS)),
      total: 0,
      attended: 0,
      ratePercent: 0,
    };
  });

  for (const record of records) {
    const time = toSortableTime(record.fecha);
    if (time === null) continue;
    const startOfRecordDay = new Date(time);
    const daysAgo = Math.round(
      (endOfToday -
        new Date(
          startOfRecordDay.getFullYear(),
          startOfRecordDay.getMonth(),
          startOfRecordDay.getDate(),
        ).getTime()) /
        DAY_MS,
    );
    if (daysAgo < 0 || daysAgo >= weeks * 7) continue;
    const bar = bars[weeks - 1 - Math.floor(daysAgo / 7)];
    bar.total += 1;
    if (countsAsAttended(record.estado)) bar.attended += 1;
  }

  let total = 0;
  let attended = 0;
  for (const bar of bars) {
    bar.ratePercent = attendanceRatePercent(bar.attended, bar.total);
    total += bar.total;
    attended += bar.attended;
  }

  return {
    bars,
    total,
    attended,
    ratePercent: attendanceRatePercent(attended, total),
  };
}

// ---------------------------------------------------------------------------
// "Actividad reciente" (Fase 3 — prototype 06)
// ---------------------------------------------------------------------------

export type ActivityKind =
  | "payment-uploaded"
  | "payment-validated"
  | "payment-rejected"
  | "attendance-session";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  /** Two-letter avatar seed derived from `subject`. */
  initials: string;
  /** The actor or the person the event is about — rendered in bold. */
  subject: string;
  /** What happened, as a predicate that follows `subject`. */
  detail: string;
  /** The instant the event carries. Date-only for attendance sessions. */
  at: string;
}

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return "?";
  return words.map((w) => w[0].toUpperCase()).join("");
}

/**
 * Merge the timestamped facts the app ALREADY fetches into one recent-activity
 * feed. No new endpoint is involved, and none is invented: every event maps to
 * a field that already travels in a DTO the admin surfaces read —
 * `PaymentValidationRequest.uploadedAt` / `.validatedAt` and
 * `AttendanceRecord.fecha`.
 *
 * The ceiling is deliberate. Both sources arrive as whatever page the API
 * returned, so this is "the latest inside what was already loaded", not a
 * history — which is why the card's action sends the reader to the full lists.
 *
 * Two groupings keep this a feed rather than a log. Attendance is grouped per
 * session (date + horario + trainer) rather than per student: 12 rows saying
 * the same trainer marked the same class is a log. And a payment is one row,
 * never an upload row plus a validation row for the same request.
 */
export function buildActivityFeed(
  requests: PaymentValidationRequest[],
  records: AttendanceRecord[],
  limit = 6,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const request of requests) {
    const amount = formatCurrency(request.expectedAmount);
    const resolved = request.validationStatus === "validado" || request.validationStatus === "rechazado";
    const resolvedAt =
      resolved && request.validatedAt && toSortableTime(request.validatedAt) !== null
        ? request.validatedAt
        : null;

    /**
     * ONE row per request, never two. Emitting the upload and its validation
     * separately put the same person on the feed twice on the same day — six
     * rows carrying three facts — so the resolution absorbs the upload and
     * states the amount the upload used to carry. When the resolution instant
     * is unusable the upload still stands on its own, so no payment is lost.
     */
    if (resolvedAt) {
      const verb = request.validationStatus === "validado" ? "validado" : "rechazado";
      events.push({
        id: `pay-res-${request.id}`,
        kind: request.validationStatus === "validado" ? "payment-validated" : "payment-rejected",
        initials: initialsFor(request.studentName),
        subject: request.studentName,
        detail: request.validatedBy
          ? `tiene su pago de ${amount} ${verb} por ${request.validatedBy}`
          : `tiene su pago de ${amount} ${verb}`,
        at: resolvedAt,
      });
      continue;
    }

    if (toSortableTime(request.uploadedAt) !== null) {
      const payer = request.responsablePagoName || request.representativeName || request.studentName;
      events.push({
        id: `pay-up-${request.id}`,
        kind: "payment-uploaded",
        initials: initialsFor(payer),
        subject: payer,
        detail: `subió un comprobante de ${amount}`,
        at: request.uploadedAt,
      });
    }
  }

  // Una sesión por (fecha, horario). Sin "quién registró": la asistencia ya
  // no guarda quién dictó la clase (issue #13), así que el sujeto del evento
  // es el propio horario.
  const sessions = new Map<string, { record: AttendanceRecord; count: number }>();
  for (const record of records) {
    if (toSortableTime(record.fecha) === null) continue;
    const key = `${record.fecha}|${record.horario}`;
    const existing = sessions.get(key);
    if (existing) existing.count += 1;
    else sessions.set(key, { record, count: 1 });
  }
  for (const [key, { record, count }] of sessions) {
    events.push({
      id: `att-${key}`,
      kind: "attendance-session",
      initials: initialsFor(record.horario),
      subject: record.horario,
      detail: `lista registrada · ${count} ${count === 1 ? "jugador" : "jugadores"}`,
      at: record.fecha,
    });
  }

  return events
    .sort((a, b) => (toSortableTime(b.at) ?? 0) - (toSortableTime(a.at) ?? 0))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Activity marker (A5 — "Actividad reciente" mixes event types with no visual
// differentiation)
// ---------------------------------------------------------------------------

/** What a caller renders to mark an activity row's `kind`. */
export interface ActivityMarker {
  tone: BadgeTone;
  label: string;
}

/**
 * The state tone for each `ActivityKind` — same three-tone vocabulary
 * `/payments` already uses for its own estados (`describePagoEstado`). Only a
 * resolved, rejected payment is `bad`: it is the one event that asks someone
 * to look again. A payment still uploading and an attendance session both
 * inform rather than alert, so they share `neutral` — the same
 * ante-la-duda-no-se-muestra default this codebase applies elsewhere, here
 * meaning "no reason yet to stand out".
 */
const ACTIVITY_KIND_TONE: Record<ActivityKind, BadgeTone> = {
  "payment-validated": "ok",
  "payment-rejected": "bad",
  "payment-uploaded": "neutral",
  "attendance-session": "neutral",
};

/** The accessible label read alongside the colour-only marker. */
const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  "payment-validated": "Pago validado",
  "payment-rejected": "Pago rechazado",
  "payment-uploaded": "Comprobante subido",
  "attendance-session": "Asistencia",
};

/**
 * Resolve the tone + accessible label for one `ActivityEvent.kind`.
 *
 * Falls back to neutral for a `kind` this build does not recognize — never
 * throws, same defensive contract as `getAttendanceBadgeTone` — so a feed
 * entry the backend grows later still renders instead of crashing the card.
 */
export function getActivityMarker(kind: ActivityKind): ActivityMarker {
  return {
    tone: ACTIVITY_KIND_TONE[kind] ?? "neutral",
    label: ACTIVITY_KIND_LABEL[kind] ?? "Actividad",
  };
}

// ---------------------------------------------------------------------------
// "Pagos por validar" — the queue the admin works from
// ---------------------------------------------------------------------------

export interface PaymentQueueRow {
  id: string;
  /** Who paid, falling back to the student when no payer is named. */
  payer: string;
  initials: string;
  /** "Mensual · $25,00" — what the receipt is for. */
  detail: string;
  /** Whole days since the receipt was uploaded. 0 for today. */
  waitingDays: number;
  /** Waiting more than a week — the row that asks to be opened first. */
  overdue: boolean;
}

export interface PaymentQueue {
  /** Oldest first, capped at `limit`. */
  rows: PaymentQueueRow[];
  /** Every pending payment, before the cap. */
  total: number;
}

/**
 * The pending payments, oldest first, capped for a dashboard block.
 *
 * Oldest first because the queue's own rule is first-in, first-out: the receipt
 * that has waited longest is the one a reader should open. Rows with an
 * unusable timestamp sort last rather than being dropped — a pending payment
 * is work whether or not its clock survived.
 */
export function buildPaymentQueue(
  requests: PaymentValidationRequest[],
  limit = 5,
  now: Date = new Date(),
): PaymentQueue {
  const pending = requests
    .filter((r) => r.validationStatus === "pendiente")
    .map((request) => ({ request, time: toSortableTime(request.uploadedAt) }))
    .sort((a, b) => (a.time ?? Number.POSITIVE_INFINITY) - (b.time ?? Number.POSITIVE_INFINITY));

  const rows = pending.slice(0, limit).map(({ request, time }): PaymentQueueRow => {
    const payer = request.responsablePagoName || request.representativeName || request.studentName;
    const waitingDays = time === null ? 0 : Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
    return {
      id: request.id,
      payer,
      initials: initialsFor(payer),
      detail: `${request.membershipType} · ${formatCurrency(request.expectedAmount)}`,
      waitingDays,
      overdue: waitingDays > 7,
    };
  });

  return { rows, total: pending.length };
}

/** "Hoy", "Hace 1 día", "Hace 5 días". */
export function formatWaiting(days: number): string {
  if (days <= 0) return "Hoy";
  return days === 1 ? "Hace 1 día" : `Hace ${days} días`;
}

// ---------------------------------------------------------------------------
// "Clases de hoy" — today's timetable read against today's lists
// ---------------------------------------------------------------------------

export type TodayClassStatus = "taken" | "missing" | "pending";

export interface TodayClass {
  scheduleId: number;
  /** "15:00 — 16:00". */
  hours: string;
  /** The category's name, when the catalog supplies one. */
  category: string | null;
  /**
   * `taken`: a list exists for this session today. `missing`: the session has
   * ended and no list was taken. `pending`: it has not ended yet — no verdict.
   */
  status: TodayClassStatus;
  /** How many records the list carries. 0 unless `taken`. */
  records: number;
  /** "15:00" / "16:00" — the timeline places the class by these. */
  horaInicio: string;
  horaFin: string;
}

/**
 * Cross today's schedules with the attendance records already loaded.
 *
 * Nothing new is fetched: `fetchAttendanceRecords()` returns records with their
 * `horarioId` and `fecha`, so "was today's 15:00 list taken" is a lookup. A
 * class is only `missing` once its end time has passed, so a morning admin does
 * not see the evening's session accused of having no list.
 */
export function buildTodayClasses(
  schedules: TrainingSchedule[],
  records: AttendanceRecord[],
  now: Date = new Date(),
): TodayClass[] {
  const today = clubIsoDate(now);
  const nowMinutes = toMinutes(clubTimeHHMM(now)) ?? 0;

  const recordsByHorario = new Map<number, number>();
  for (const record of records) {
    if (record.fecha !== today) continue;
    recordsByHorario.set(record.horarioId, (recordsByHorario.get(record.horarioId) ?? 0) + 1);
  }

  return [...schedules]
    .sort((a, b) => (toMinutes(a.horaInicio) ?? 0) - (toMinutes(b.horaInicio) ?? 0))
    .map((schedule): TodayClass => {
      const count = recordsByHorario.get(schedule.id) ?? 0;
      const end = toMinutes(schedule.horaFin);
      const ended = end !== null && end <= nowMinutes;
      return {
        scheduleId: schedule.id,
        hours: `${schedule.horaInicio} — ${schedule.horaFin}`,
        category: schedule.categoriaLabel ?? null,
        status: count > 0 ? "taken" : ended ? "missing" : "pending",
        records: count,
        horaInicio: schedule.horaInicio,
        horaFin: schedule.horaFin,
      };
    });
}

// ---------------------------------------------------------------------------
// "Hoy en el club" — today's classes on a timeline
// ---------------------------------------------------------------------------

/** Minutes since midnight on the club's clock. */
export function clubNowMinutes(now: Date = new Date()): number {
  return toMinutes(clubTimeHHMM(now)) ?? 0;
}

const TIMELINE_STATUS_LABEL: Record<TimelineStatus, string> = {
  pending: "Pendiente",
  live: "En curso",
  done: "Lista tomada",
  missing: "Sin lista",
};

/**
 * Today's classes as timeline items. A class with a list is `done` whatever the
 * clock says; without one it is `live` while it runs, `missing` once it ended
 * and `pending` before it starts. `enrolled` is the roster count per horario
 * when the roster arrived (an unknown count says nothing rather than "0").
 */
export function buildTimelineItems(
  classes: TodayClass[],
  enrolled: Record<number, number> | null,
  hrefFor: (scheduleId: number) => string,
  now: Date = new Date(),
): TimelineItem[] {
  const nowMinutes = clubNowMinutes(now);
  return classes.map((entry): TimelineItem => {
    const start = toMinutes(entry.horaInicio);
    const end = toMinutes(entry.horaFin);
    const running = start !== null && end !== null && start <= nowMinutes && nowMinutes < end;
    const status: TimelineStatus = entry.status === "taken" ? "done" : running ? "live" : entry.status === "missing" ? "missing" : "pending";
    const count = enrolled?.[entry.scheduleId];
    return {
      id: String(entry.scheduleId),
      start: entry.horaInicio,
      end: entry.horaFin,
      title: entry.category ?? "Clase",
      group: entry.category ?? "Clase",
      status,
      statusLabel: TIMELINE_STATUS_LABEL[status],
      note: count === undefined ? null : count === 1 ? "1 inscrito" : `${count} inscritos`,
      href: hrefFor(entry.scheduleId),
    };
  });
}

// ---------------------------------------------------------------------------
// Payments: how long they wait, and where they all stand
// ---------------------------------------------------------------------------

export interface PaymentAgeBuckets {
  today: number;
  recent: number;
  old: number;
}

/** Pending payments by how long they have waited: hoy / 1–3 días / más de 3. */
export function buildPaymentAgeBuckets(requests: PaymentValidationRequest[], now: Date = new Date()): PaymentAgeBuckets {
  const buckets: PaymentAgeBuckets = { today: 0, recent: 0, old: 0 };
  for (const request of requests) {
    if (request.validationStatus !== "pendiente") continue;
    const time = toSortableTime(request.uploadedAt);
    const days = time === null ? 0 : Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
    if (days < 1) buckets.today += 1;
    else if (days <= 3) buckets.recent += 1;
    else buckets.old += 1;
  }
  return buckets;
}

export interface PaymentPipeline {
  pendiente: number;
  validado: number;
  rechazado: number;
}

/** Every payment request by state — the whole loaded list, not just the queue. */
export function buildPaymentPipeline(requests: PaymentValidationRequest[]): PaymentPipeline {
  const pipeline: PaymentPipeline = { pendiente: 0, validado: 0, rechazado: 0 };
  for (const request of requests) pipeline[request.validationStatus] += 1;
  return pipeline;
}

// ---------------------------------------------------------------------------
// Attendance by state, week by week
// ---------------------------------------------------------------------------

export interface WeeklyStatusColumn {
  /** "YYYY-MM-DD" of the first day of the 7-day window. */
  startIso: string;
  counts: Record<EstadoAsistencia, number>;
  total: number;
}

/**
 * Bucket records into the trailing N 7-day windows ending today (oldest first),
 * counting each attendance state. Same windowing as `buildFourWeekAttendance`,
 * so the tile and the chart agree about what "a week" is.
 */
export function buildWeeklyStatusBreakdown(
  records: AttendanceRecord[],
  today: Date = new Date(),
  weeks = 6,
): WeeklyStatusColumn[] {
  const clubNow = clubToday(today);
  const endOfToday = new Date(clubNow.getFullYear(), clubNow.getMonth(), clubNow.getDate()).getTime();
  const columns: WeeklyStatusColumn[] = Array.from({ length: weeks }, (_, i) => ({
    startIso: calendarIsoDate(new Date(endOfToday - ((weeks - 1 - i) * 7 + 6) * DAY_MS)),
    counts: { present: 0, late: 0, sick: 0, competition: 0, absent: 0 },
    total: 0,
  }));

  for (const record of records) {
    const time = toSortableTime(record.fecha);
    if (time === null || !(record.estado in columns[0].counts)) continue;
    const day = new Date(time);
    const daysAgo = Math.round((endOfToday - new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()) / DAY_MS);
    if (daysAgo < 0 || daysAgo >= weeks * 7) continue;
    const column = columns[weeks - 1 - Math.floor(daysAgo / 7)];
    column.counts[record.estado] += 1;
    column.total += 1;
  }
  return columns;
}

/** The attendance states in chart order, with their validated palette. */
export function attendanceChartSeries(): { key: EstadoAsistencia; label: string; color: string }[] {
  return ATTENDANCE_STATUS_ORDER.map((estado) => ({
    key: estado,
    label: ATTENDANCE_LABELS[estado],
    color: ATTENDANCE_STATUS_CHART_COLORS[estado],
  }));
}

// ---------------------------------------------------------------------------
// Activity filters
// ---------------------------------------------------------------------------

export type ActivityFilter = "all" | "payments" | "attendance";

export function filterActivity(events: ActivityEvent[], filter: ActivityFilter): ActivityEvent[] {
  if (filter === "all") return events;
  return events.filter((event) => (filter === "payments" ? event.kind.startsWith("payment") : event.kind === "attendance-session"));
}
