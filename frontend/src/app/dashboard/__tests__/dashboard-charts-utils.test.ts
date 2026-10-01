/**
 * The pure helpers behind the admin dashboard's pictures: timeline items,
 * payment ages and pipeline, the weekly state breakdown and the activity filter.
 */

import { describe, it, expect } from "vitest";
import {
  buildPaymentAgeBuckets,
  buildPaymentPipeline,
  buildTimelineItems,
  buildWeeklyStatusBreakdown,
  filterActivity,
  type ActivityEvent,
  type TodayClass,
} from "../dashboard-utils";
import type { AttendanceRecord } from "@/app/attendance/attendance-utils";
import type { PaymentValidationRequest } from "@/services/api";

// Wednesday 2026-09-30, 12:00 in Guayaquil (UTC-5).
const NOW = new Date("2026-09-30T17:00:00Z");

function cls(scheduleId: number, horaInicio: string, horaFin: string, status: TodayClass["status"], category: string | null = "Formativo"): TodayClass {
  return { scheduleId, hours: `${horaInicio} — ${horaFin}`, category, status, records: status === "taken" ? 5 : 0, horaInicio, horaFin } as TodayClass;
}

describe("buildTimelineItems", () => {
  const href = (id: number) => `/trainer/attendance?horario=${id}`;

  it("marks a taken list done whatever the clock says, a running one live, an ended one missing and a future one pending", () => {
    const items = buildTimelineItems(
      [cls(1, "08:00", "09:00", "taken"), cls(2, "11:30", "12:30", "pending"), cls(3, "09:00", "10:00", "missing"), cls(4, "15:00", "16:00", "pending")],
      null,
      href,
      NOW,
    );
    expect(items.map((item) => item.status)).toEqual(["done", "live", "missing", "pending"]);
    expect(items.map((item) => item.statusLabel)).toEqual(["Lista tomada", "En curso", "Sin lista", "Pendiente"]);
  });

  it("names the group after the category, falling back to a generic class", () => {
    const [a, b] = buildTimelineItems([cls(1, "15:00", "16:00", "pending"), cls(2, "16:00", "17:00", "pending", null)], null, href, NOW);
    expect(a.group).toBe("Formativo");
    expect(b.title).toBe("Clase");
  });

  it("says the roster count only when the roster arrived, singular included", () => {
    const classes = [cls(1, "15:00", "16:00", "pending"), cls(2, "16:00", "17:00", "pending"), cls(3, "17:00", "18:00", "pending")];
    const withRoster = buildTimelineItems(classes, { 1: 12, 2: 1 }, href, NOW);
    expect(withRoster.map((item) => item.note)).toEqual(["12 inscritos", "1 inscrito", null]);
    expect(buildTimelineItems(classes, null, href, NOW).every((item) => !item.note)).toBe(true);
  });

  it("links each item through the given builder", () => {
    expect(buildTimelineItems([cls(7, "15:00", "16:00", "pending")], null, href, NOW)[0].href).toBe("/trainer/attendance?horario=7");
  });
});

function payment(status: PaymentValidationRequest["validationStatus"], daysAgo: number): PaymentValidationRequest {
  return {
    id: `${status}-${daysAgo}-${Math.random()}`,
    uploadedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    validationStatus: status,
  } as PaymentValidationRequest;
}

describe("payments", () => {
  it("buckets only the pending ones by how long they have waited", () => {
    const buckets = buildPaymentAgeBuckets(
      [payment("pendiente", 0), payment("pendiente", 1), payment("pendiente", 3), payment("pendiente", 4), payment("pendiente", 20), payment("validado", 30)],
      NOW,
    );
    expect(buckets).toEqual({ today: 1, recent: 2, old: 2 });
  });

  it("counts the pipeline by validation status", () => {
    expect(buildPaymentPipeline([payment("pendiente", 1), payment("validado", 1), payment("validado", 2), payment("rechazado", 1)])).toEqual({
      pendiente: 1,
      validado: 2,
      rechazado: 1,
    });
    expect(buildPaymentPipeline([])).toEqual({ pendiente: 0, validado: 0, rechazado: 0 });
  });
});

function rec(fecha: string, estado: AttendanceRecord["estado"]): AttendanceRecord {
  return { id: `${fecha}-${estado}-${Math.random()}`, fecha, horario: "x", horarioId: 1, personaId: 1, estudiante: "A", estado };
}

describe("buildWeeklyStatusBreakdown", () => {
  it("returns N columns oldest first, the last one ending today", () => {
    const columns = buildWeeklyStatusBreakdown([], NOW, 6);
    expect(columns).toHaveLength(6);
    expect(columns[5].startIso).toBe("2026-09-24");
    expect(columns[0].startIso).toBe("2026-08-20");
  });

  it("counts each state in its own week and ignores records outside the window", () => {
    const columns = buildWeeklyStatusBreakdown(
      [rec("2026-09-30", "present"), rec("2026-09-24", "absent"), rec("2026-09-23", "late"), rec("2026-01-01", "present"), rec("2026-10-05", "present")],
      NOW,
      6,
    );
    expect(columns[5].counts).toMatchObject({ present: 1, absent: 1 });
    expect(columns[5].total).toBe(2);
    expect(columns[4].counts.late).toBe(1);
    expect(columns.reduce((sum, column) => sum + column.total, 0)).toBe(3);
  });
});

describe("filterActivity", () => {
  const events = [{ kind: "payment-validated" }, { kind: "payment-uploaded" }, { kind: "attendance-session" }] as ActivityEvent[];

  it("keeps everything for 'all', payments for 'payments' and lists for 'attendance'", () => {
    expect(filterActivity(events, "all")).toHaveLength(3);
    expect(filterActivity(events, "payments")).toHaveLength(2);
    expect(filterActivity(events, "attendance")).toHaveLength(1);
  });
});
