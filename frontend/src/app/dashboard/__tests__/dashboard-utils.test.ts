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
  buildActivityFeed,
} from "../dashboard-utils";
import type { AttendanceDayStats, AttendanceRecord } from "@/app/attendance/attendance-utils";
import type { PaymentValidationRequest } from "@/services/api";

function buildStats(overrides: Partial<AttendanceDayStats> = {}): AttendanceDayStats {
  return {
    totalPresent: 0,
    totalAbsent: 0,
    totalLate: 0,
    totalJustified: 0,
    totalUnknown: 0,
    totalStudents: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildAttendanceStatusSegments
// ---------------------------------------------------------------------------

describe("buildAttendanceStatusSegments", () => {
  it("computes rounded percentages against the total record count, in present/late/justified/absent order", () => {
    const stats = buildStats({
      totalPresent: 60,
      totalLate: 20,
      totalJustified: 10,
      totalAbsent: 10,
      totalStudents: 100,
    });
    const segments = buildAttendanceStatusSegments(stats);
    expect(segments.map((s) => s.estado)).toEqual(["present", "late", "justified", "absent"]);
    expect(segments.map((s) => s.percentage)).toEqual([60, 20, 10, 10]);
    expect(segments.map((s) => s.value)).toEqual([60, 20, 10, 10]);
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

  it("includes a segment even when its count is zero, so the legend always shows all 4 states", () => {
    const segments = buildAttendanceStatusSegments(buildStats({ totalPresent: 5, totalStudents: 5 }));
    expect(segments).toHaveLength(4);
    expect(segments.find((s) => s.estado === "absent")?.value).toBe(0);
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
    proofFileName: "comprobante.png",
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
    personaId: 1,
    estudiante: "Sofia Vera Zamora",
    estado: "present",
    entrenador: "Carlos Mendoza",
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
    expect(result.ratePercent).toBe(50);
    expect(result.total).toBe(4);
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
      subject: "Carlos Mendoza",
      detail: "registró la lista de Lunes 15:00 — 16:00 · 3 estudiantes",
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
