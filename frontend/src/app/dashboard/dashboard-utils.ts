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
import { calendarIsoDate, clubToday } from "@/lib/club-date";

export const ATTENDANCE_STATUS_CHART_COLORS: Record<EstadoAsistencia, string> = {
  present: "#008300",
  late: "#eda100",
  justified: "#2a78d6",
  absent: "#e34948",
};

/** Fixed render order — also the validated adjacent-pair order (do not reorder without re-running the validator). */
const ATTENDANCE_STATUS_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

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
 * returns all 4 states (even at 0 count) so the legend shows the full picture.
 * Percentage is 0 for every segment when there are no records — never NaN.
 */
export function buildAttendanceStatusSegments(stats: AttendanceDayStats): AttendanceStatusSegment[] {
  const countByEstado: Record<EstadoAsistencia, number> = {
    present: stats.totalPresent,
    late: stats.totalLate,
    justified: stats.totalJustified,
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
  present: number;
  /** Rounded 0-100 share of records marked present. 0 when the week is empty. */
  ratePercent: number;
}

export interface FourWeekAttendance {
  /** Oldest window first, so the bars read left to right as time passes. */
  bars: AttendanceWeekBar[];
  total: number;
  present: number;
  /** Presence rate across the whole window. 0 when there are no records. */
  ratePercent: number;
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
      present: 0,
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
    if (record.estado === "present") bar.present += 1;
  }

  let total = 0;
  let present = 0;
  for (const bar of bars) {
    bar.ratePercent = bar.total > 0 ? Math.round((bar.present / bar.total) * 100) : 0;
    total += bar.total;
    present += bar.present;
  }

  return {
    bars,
    total,
    present,
    ratePercent: total > 0 ? Math.round((present / total) * 100) : 0,
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

function initialsFor(name: string): string {
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

  const sessions = new Map<string, { record: AttendanceRecord; count: number }>();
  for (const record of records) {
    if (toSortableTime(record.fecha) === null) continue;
    const key = `${record.fecha}|${record.horario}|${record.entrenador}`;
    const existing = sessions.get(key);
    if (existing) existing.count += 1;
    else sessions.set(key, { record, count: 1 });
  }
  for (const [key, { record, count }] of sessions) {
    events.push({
      id: `att-${key}`,
      kind: "attendance-session",
      initials: initialsFor(record.entrenador),
      subject: record.entrenador,
      detail: `registró la lista de ${record.horario} · ${count} ${count === 1 ? "estudiante" : "estudiantes"}`,
      at: record.fecha,
    });
  }

  return events
    .sort((a, b) => (toSortableTime(b.at) ?? 0) - (toSortableTime(a.at) ?? 0))
    .slice(0, limit);
}
