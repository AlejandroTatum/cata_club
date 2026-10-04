/**
 * Unit tests for the dashboard's pure chart helpers.
 *
 * Pure functions — no React dependencies, easy to test.
 */

import { describe, it, expect } from "vitest";
import {
  buildAttendanceStatusSegments,
  buildDonutArcs,
  ATTENDANCE_STATUS_CHART_COLORS,
  countPaymentsWaitingOverAWeek,
  buildFourWeekAttendance,
  attendanceWindowStartIso,
  buildActivityFeed,
  getActivityMarker,
  type ActivityKind,
} from "../dashboard-utils";
import type { AttendanceDayStats, AttendanceRecord } from "@/app/attendance/attendance-utils";
import type { PaymentValidationRequest } from "@/services/api";

function buildStats(overrides: Partial<AttendanceDayStats> = {}): AttendanceDayStats {
  return {
    totalPresent: 0,
    totalAbsent: 0,
    totalLate: 0,
    totalSick: 0,
    totalCompetition: 0,
    totalUnknown: 0,
    totalStudents: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildAttendanceStatusSegments
// ---------------------------------------------------------------------------

describe("buildAttendanceStatusSegments", () => {
  it("computes rounded percentages against the total record count, in present/late/sick/competition/absent order", () => {
    const stats = buildStats({
      totalPresent: 50,
      totalLate: 20,
      totalSick: 20,
      totalCompetition: 5,
      totalAbsent: 5,
      totalStudents: 100,
    });
    const segments = buildAttendanceStatusSegments(stats);
    expect(segments.map((s) => s.estado)).toEqual(["present", "late", "sick", "competition", "absent"]);
    expect(segments.map((s) => s.percentage)).toEqual([50, 20, 20, 5, 5]);
    expect(segments.map((s) => s.value)).toEqual([50, 20, 20, 5, 5]);
  });

  it("returns 0% for every segment when there are no records at all (never divides by zero)", () => {
    const segments = buildAttendanceStatusSegments(buildStats());
    expect(segments.every((s) => s.percentage === 0)).toBe(true);
  });

  it("assigns each estado its validated chart color", () => {
    const segments = buildAttendanceStatusSegments(buildStats({ totalPresent: 1, totalStudents: 1 }));
    for (const segment of segments) {
      expect(segment.color).toBe(ATTENDANCE_STATUS_CHART_COLORS[segment.estado]);
    }
  });

  it("includes a segment even when its count is zero, so the legend always shows all 5 states", () => {
    const segments = buildAttendanceStatusSegments(buildStats({ totalPresent: 5, totalStudents: 5 }));
    expect(segments).toHaveLength(5);
    expect(segments.find((s) => s.estado === "absent")?.value).toBe(0);
  });

  it("never folds sick/competition into the absent segment (issue #1373: authorized absences)", () => {
    const segments = buildAttendanceStatusSegments(
      buildStats({ totalSick: 3, totalCompetition: 2, totalAbsent: 1, totalStudents: 6 }),
    );
    expect(segments.find((s) => s.estado === "sick")?.value).toBe(3);
    expect(segments.find((s) => s.estado === "competition")?.value).toBe(2);
    expect(segments.find((s) => s.estado === "absent")?.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildDonutArcs
// ---------------------------------------------------------------------------

describe("buildDonutArcs", () => {
  const CIRCUMFERENCE = 100;

  it("splits the circumference proportionally, offsetting each arc by the cumulative length of the previous ones", () => {
    const arcs = buildDonutArcs([50, 30, 20], CIRCUMFERENCE);
    expect(arcs[0].dashOffset).toBe(-0);
    expect(arcs[1].dashOffset).toBe(-50);
    expect(arcs[2].dashOffset).toBe(-80);
  });

  it("leaves a visual gap between segments when more than one is non-zero", () => {
    const [first] = buildDonutArcs([50, 50], CIRCUMFERENCE);
    const [visibleLength] = first.dashArray.split(" ").map(Number);
    expect(visibleLength).toBeLessThan(50);
  });

  it("renders a full ring with no gap when only one segment is non-zero", () => {
    const [first] = buildDonutArcs([100, 0, 0], CIRCUMFERENCE);
    const [visibleLength] = first.dashArray.split(" ").map(Number);
    expect(visibleLength).toBe(100);
  });

  it("renders every segment as invisible (never NaN) when the total is zero", () => {
    const arcs = buildDonutArcs([0, 0, 0], CIRCUMFERENCE);
    for (const arc of arcs) {
      expect(arc.dashArray).toBe(`0 ${CIRCUMFERENCE}`);
      expect(arc.dashOffset).toBe(0);
    }
  });

  it("renders a zero-length arc for a zero-value segment mixed with non-zero ones", () => {
    const arcs = buildDonutArcs([100, 0], CIRCUMFERENCE);
    const [zeroLength] = arcs[1].dashArray.split(" ").map(Number);
    expect(zeroLength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countPaymentsWaitingOverAWeek
// ---------------------------------------------------------------------------

/**
 * 23 jul 2026, 09:00 at the club (14:00 UTC).
 *
 * An explicit instant, NOT `new Date(2026, 6, 23, 9, 0)`: `buildFourWeekAttendance`
 * resolves its window through `clubToday()` (America/Guayaquil), so a fixture
 * built from the runner's local components lands on a different club day on any
 * machine far enough from Ecuador — under `TZ=Asia/Tokyo` it resolves to
 * 2026-07-22 and every record falls outside the window. UTC-5 and UTC both
 * happened to keep 09:00 inside the same calendar day, which is coincidence,
 * not coverage.
 */
const NOW = new Date("2026-07-23T14:00:00Z");

function buildRequest(overrides: Partial<PaymentValidationRequest> = {}): PaymentValidationRequest {
  return {
    id: "req-1",
    studentName: "Sofia Vera Zamora",
    responsablePagoName: "Laura Vera",
    membershipPeriod: "01/07/2026 – 12/08/2026",
    membershipType: "Mensual",
    expectedAmount: 25,
    paymentMethod: "Transferencia",
    uploadedAt: new Date(2026, 6, 22, 18, 42).toISOString(),
    currentMembershipStatus: "vencida",
    proofFileType: "image",
    validationStatus: "pendiente",
    startDate: "2026-07-01",
    endDate: "2026-08-12",
    ...overrides,
  };
}

function buildRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: "att-1",
    fecha: "2026-07-23",
    horario: "Lunes 15:00 — 16:00",
    horarioId: 1,
    personaId: 1,
    estudiante: "Sofia Vera Zamora",
    estado: "present",
    ...overrides,
  };
}

describe("countPaymentsWaitingOverAWeek", () => {
  it("counts only pending requests older than seven days", () => {
    const requests = [
      buildRequest({ id: "a", uploadedAt: new Date(2026, 6, 10).toISOString() }),
      buildRequest({ id: "b", uploadedAt: new Date(2026, 6, 22).toISOString() }),
    ];
    expect(countPaymentsWaitingOverAWeek(requests, NOW)).toBe(1);
  });

  it("ignores already-resolved requests no matter how old they are", () => {
    const requests = [
      buildRequest({ id: "a", uploadedAt: new Date(2026, 5, 1).toISOString(), validationStatus: "validado" }),
      buildRequest({ id: "b", uploadedAt: new Date(2026, 5, 1).toISOString(), validationStatus: "rechazado" }),
    ];
    expect(countPaymentsWaitingOverAWeek(requests, NOW)).toBe(0);
  });

  it("ignores requests whose upload date cannot be read", () => {
    expect(countPaymentsWaitingOverAWeek([buildRequest({ uploadedAt: "" })], NOW)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildFourWeekAttendance
// ---------------------------------------------------------------------------

describe("buildFourWeekAttendance", () => {
  it("always returns four bars, oldest first, even with no records", () => {
    const result = buildFourWeekAttendance([], NOW);
    expect(result.bars).toHaveLength(4);
    expect(result.bars.map((b) => b.startIso)).toEqual([
      "2026-06-26",
      "2026-07-03",
      "2026-07-10",
      "2026-07-17",
    ]);
    expect(result.ratePercent).toBe(0);
  });

  it("puts today's records in the newest bar and last month's outside the window", () => {
    const result = buildFourWeekAttendance(
      [
        buildRecord({ id: "1", fecha: "2026-07-23" }),
        buildRecord({ id: "2", fecha: "2026-05-01" }),
      ],
      NOW,
    );
    expect(result.bars[3].total).toBe(1);
    expect(result.total).toBe(1);
  });

  it("computes the presence rate per bar and across the whole window", () => {
    const result = buildFourWeekAttendance(
      [
        buildRecord({ id: "1", fecha: "2026-07-23", estado: "present" }),
        buildRecord({ id: "2", fecha: "2026-07-23", estado: "absent" }),
        buildRecord({ id: "3", fecha: "2026-07-01", estado: "present" }),
        buildRecord({ id: "4", fecha: "2026-07-01", estado: "late" }),
      ],
      NOW,
    );
    expect(result.bars[3].ratePercent).toBe(50);
    expect(result.ratePercent).toBe(75);
    expect(result.attended).toBe(3);
    expect(result.total).toBe(4);
  });

  it("counts tardanza as attendance, like the Asistencias screen (ADMA-34)", () => {
    const result = buildFourWeekAttendance(
      [
        buildRecord({ id: "1", fecha: "2026-07-23", estado: "present" }),
        buildRecord({ id: "2", fecha: "2026-07-23", estado: "late" }),
        buildRecord({ id: "3", fecha: "2026-07-23", estado: "absent" }),
        buildRecord({ id: "4", fecha: "2026-07-23", estado: "absent" }),
      ],
      NOW,
    );
    expect(result.attended).toBe(2);
    expect(result.bars[3].attended).toBe(2);
    expect(result.bars[3].ratePercent).toBe(50);
    expect(result.ratePercent).toBe(50);
  });

  it("keeps enfermo and competencia in the total but never as attendance (C1 semantics)", () => {
    const result = buildFourWeekAttendance(
      [
        buildRecord({ id: "1", fecha: "2026-07-23", estado: "present" }),
        buildRecord({ id: "2", fecha: "2026-07-23", estado: "sick" }),
        buildRecord({ id: "3", fecha: "2026-07-23", estado: "competition" }),
        buildRecord({ id: "4", fecha: "2026-07-23", estado: "late" }),
      ],
      NOW,
    );
    expect(result.total).toBe(4);
    expect(result.attended).toBe(2);
    expect(result.ratePercent).toBe(50);
  });

  it("never produces NaN for a week with no records", () => {
    const result = buildFourWeekAttendance([buildRecord({ fecha: "2026-07-23" })], NOW);
    expect(result.bars[0].ratePercent).toBe(0);
  });

  it("does not count a future-dated record in the current window", () => {
    const result = buildFourWeekAttendance([buildRecord({ fecha: "2026-08-01" })], NOW);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildActivityFeed
// ---------------------------------------------------------------------------

describe("buildActivityFeed", () => {
  it("turns a payment upload into an event attributed to whoever pays", () => {
    const feed = buildActivityFeed([buildRequest()], []);
    expect(feed[0]).toMatchObject({
      kind: "payment-uploaded",
      subject: "Laura Vera",
      initials: "LV",
      detail: "subió un comprobante de $25,00",
    });
  });

  it("collapses an upload and its resolution into a single row", () => {
    const feed = buildActivityFeed(
      [
        buildRequest({
          validationStatus: "validado",
          validatedAt: new Date(2026, 6, 23, 8, 0).toISOString(),
          validatedBy: "Admin Dev",
        }),
      ],
      [],
    );
    // One request is one fact: "it was paid and then validated". Two rows for
    // the same person on the same day read as clutter, not as history.
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      kind: "payment-validated",
      subject: "Sofia Vera Zamora",
      detail: "tiene su pago de $25,00 validado por Admin Dev",
    });
    // Carried at the resolution instant — the newer of the two.
    expect(feed[0].at).toBe(new Date(2026, 6, 23, 8, 0).toISOString());
  });

  it("names the rejection rather than glossing it as a resolution", () => {
    const feed = buildActivityFeed(
      [
        buildRequest({
          validationStatus: "rechazado",
          validatedAt: new Date(2026, 6, 23, 8, 0).toISOString(),
        }),
      ],
      [],
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      kind: "payment-rejected",
      detail: "tiene su pago de $25,00 rechazado",
    });
  });

  it("falls back to the upload when a resolved payment carries no usable resolution date", () => {
    const feed = buildActivityFeed(
      [buildRequest({ validationStatus: "validado", validatedAt: "no es una fecha" })],
      [],
    );
    // Losing the resolution instant must not lose the payment itself.
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: "payment-uploaded", subject: "Laura Vera" });
  });

  it("never emits two rows for the same payment request", () => {
    const feed = buildActivityFeed(
      [
        buildRequest({
          id: "req-9",
          validationStatus: "validado",
          validatedAt: new Date(2026, 6, 23, 8, 0).toISOString(),
        }),
      ],
      [],
    );
    expect(new Set(feed.map((event) => event.id)).size).toBe(feed.length);
    expect(feed.filter((event) => event.id.includes("req-9"))).toHaveLength(1);
  });

  it("collapses one session's records into a single event with the head count", () => {
    const feed = buildActivityFeed(
      [],
      [
        buildRecord({ id: "1", estudiante: "A" }),
        buildRecord({ id: "2", estudiante: "B" }),
        buildRecord({ id: "3", estudiante: "C" }),
      ],
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      kind: "attendance-session",
      subject: "Lunes 15:00 — 16:00",
      detail: "lista registrada · 3 estudiantes",
    });
  });

  it("keeps separate sessions separate", () => {
    const feed = buildActivityFeed(
      [],
      [
        buildRecord({ id: "1", fecha: "2026-07-23" }),
        buildRecord({ id: "2", fecha: "2026-07-22" }),
      ],
    );
    expect(feed).toHaveLength(2);
  });

  it("orders newest first and caps the feed", () => {
    const feed = buildActivityFeed(
      [
        buildRequest({ id: "old", uploadedAt: new Date(2026, 6, 1).toISOString() }),
        buildRequest({ id: "new", uploadedAt: new Date(2026, 6, 23, 20, 0).toISOString() }),
      ],
      [buildRecord()],
      2,
    );
    expect(feed).toHaveLength(2);
    expect(feed[0].id).toBe("pay-up-new");
  });

  it("drops events whose date cannot be read instead of ranking them arbitrarily", () => {
    const feed = buildActivityFeed(
      [buildRequest({ uploadedAt: "no es una fecha" })],
      [buildRecord({ fecha: "" })],
    );
    expect(feed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getActivityMarker
// ---------------------------------------------------------------------------

describe("getActivityMarker", () => {
  it("marks a validated payment ok", () => {
    expect(getActivityMarker("payment-validated")).toEqual({ tone: "ok", label: "Pago validado" });
  });

  it("marks a rejected payment bad — the only tone meant to stand out while scanning", () => {
    expect(getActivityMarker("payment-rejected")).toEqual({ tone: "bad", label: "Pago rechazado" });
  });

  it("marks an attendance session neutral", () => {
    expect(getActivityMarker("attendance-session")).toEqual({ tone: "neutral", label: "Asistencia" });
  });

  it("marks an uploaded payment neutral — it has not been resolved yet", () => {
    expect(getActivityMarker("payment-uploaded")).toEqual({
      tone: "neutral",
      label: "Comprobante subido",
    });
  });

  it("falls back to neutral for an unrecognized kind instead of throwing", () => {
    expect(getActivityMarker("something-new" as ActivityKind)).toEqual({
      tone: "neutral",
      label: "Actividad",
    });
  });
});

// ---------------------------------------------------------------------------
// buildPaymentQueue / formatWaiting / buildTodayClasses
// ---------------------------------------------------------------------------

import { buildPaymentQueue, buildTodayClasses, formatWaiting } from "../dashboard-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";

const QUEUE_NOW = new Date("2026-09-29T15:30:00-05:00");

function queuePayment(id: string, daysAgo: number, status: PaymentValidationRequest["validationStatus"] = "pendiente"): PaymentValidationRequest {
  return {
    id,
    studentName: `Alumno ${id}`,
    responsablePagoName: `Pagador ${id}`,
    membershipPeriod: "01/09/2026 – 30/09/2026",
    membershipType: "Mensual",
    expectedAmount: 25,
    paymentMethod: "Transferencia",
    uploadedAt: new Date(QUEUE_NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    currentMembershipStatus: "vencida",
    proofFileType: "image",
    validationStatus: status,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  };
}

describe("buildPaymentQueue", () => {
  it("keeps only pending payments, oldest first, capped at the limit", () => {
    const queue = buildPaymentQueue(
      [queuePayment("new", 1), queuePayment("old", 9), queuePayment("done", 20, "validado"), queuePayment("mid", 4)],
      2,
      QUEUE_NOW,
    );
    expect(queue.total).toBe(3);
    expect(queue.rows.map((r) => r.id)).toEqual(["old", "mid"]);
  });

  it("marks a receipt waiting more than a week as overdue and names the payer", () => {
    const [row] = buildPaymentQueue([queuePayment("a", 9)], 5, QUEUE_NOW).rows;
    expect(row.waitingDays).toBe(9);
    expect(row.overdue).toBe(true);
    expect(row.payer).toBe("Pagador a");
    expect(row.detail).toBe("Mensual · $25,00");
  });

  it("is empty, not broken, when nothing is pending", () => {
    expect(buildPaymentQueue([queuePayment("x", 3, "rechazado")], 5, QUEUE_NOW)).toEqual({ rows: [], total: 0 });
  });
});

describe("formatWaiting", () => {
  it("speaks in days, singular included", () => {
    expect(formatWaiting(0)).toBe("Hoy");
    expect(formatWaiting(1)).toBe("Hace 1 día");
    expect(formatWaiting(6)).toBe("Hace 6 días");
  });
});

describe("buildTodayClasses", () => {
  const schedule = (id: number, horaInicio: string, horaFin: string): TrainingSchedule => ({
    id,
    diaSemana: "mar",
    horaInicio,
    horaFin,
    categoriaLabel: "Sub-12",
  });
  const record = (horarioId: number, fecha = "2026-09-29"): AttendanceRecord => ({
    id: `r${horarioId}${fecha}`,
    fecha,
    horario: "Martes",
    horarioId,
    personaId: 1,
    estudiante: "A",
    estado: "present",
  });

  it("orders by start time and states each list as taken, missing or pending", () => {
    const classes = buildTodayClasses(
      [schedule(3, "18:00", "19:00"), schedule(1, "09:00", "10:00"), schedule(2, "14:00", "15:00")],
      [record(2), record(2)],
      QUEUE_NOW,
    );
    expect(classes.map((c) => [c.scheduleId, c.status])).toEqual([
      [1, "missing"],
      [2, "taken"],
      [3, "pending"],
    ]);
    expect(classes[1].records).toBe(2);
    expect(classes[0].hours).toBe("09:00 — 10:00");
  });

  it("ignores records from other days", () => {
    const [only] = buildTodayClasses([schedule(1, "18:00", "19:00")], [record(1, "2026-09-28")], QUEUE_NOW);
    expect(only.status).toBe("pending");
  });
});

describe("attendanceWindowStartIso (PERF-03)", () => {
  it("starts on the first day of the oldest weekly window the charts draw", () => {
    // 6 windows of 7 days ending today: the oldest starts 41 days back.
    expect(attendanceWindowStartIso(6, new Date("2026-10-03T15:00:00Z"))).toBe("2026-08-23");
  });

  it("matches the first bar of buildFourWeekAttendance", () => {
    const today = new Date("2026-10-03T15:00:00Z");
    expect(attendanceWindowStartIso(4, today)).toBe(buildFourWeekAttendance([], today, 4).bars[0].startIso);
  });
});
