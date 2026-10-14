import { describe, expect, it } from "vitest";
import { ATTENDANCE_BLOCKED_BY_NON_PAYMENT_CODE, isAttendanceBlockedByNonPayment } from "@/lib/attendance-block";

describe("isAttendanceBlockedByNonPayment", () => {
  it("recognises the backend's non-payment refusal code", () => {
    expect(ATTENDANCE_BLOCKED_BY_NON_PAYMENT_CODE).toBe("asistencia_bloqueada_por_impago");
    expect(isAttendanceBlockedByNonPayment("asistencia_bloqueada_por_impago")).toBe(true);
  });

  it("rejects any other code, a missing code and a non-string value", () => {
    expect(isAttendanceBlockedByNonPayment("otro_codigo")).toBe(false);
    expect(isAttendanceBlockedByNonPayment(null)).toBe(false);
    expect(isAttendanceBlockedByNonPayment(undefined)).toBe(false);
    expect(isAttendanceBlockedByNonPayment(400)).toBe(false);
    expect(isAttendanceBlockedByNonPayment("Ana tiene un pago pendiente.")).toBe(false);
  });
});
