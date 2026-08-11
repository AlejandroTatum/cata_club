import { describe, expect, it } from "vitest";
import {
  filterPagosByStatus,
  sortPagosByDate,
  formatPagoMonto,
  getEmptyStateMessage,
  describePagoEstado,
  pagoFaltaComprobante,
  countPagosByStatus,
  wholeMonthsFor,
  addMonthsIso,
  type PagoStatusFilter,
} from "../payments-utils";
import type { PagoPersona } from "@/services/api";

function makePago(overrides: Partial<PagoPersona> = {}): PagoPersona {
  return {
    id: 1,
    monto: "35.00",
    motivoRechazo: null,
    estadoPago: "PENDIENTE_VALIDACION",
    tipoPago: "TRANSFERENCIA",
    fechaRegistro: "2026-07-01T10:00:00",
    fechaValidacion: null,
    fechaInicio: "2026-07-01",
    fechaFin: "2026-07-31",
    personaId: 1,
    membresiaId: 1,
    voucherUrl: null,
    voucherFormato: null,
    ...overrides,
  };
}

describe("filterPagosByStatus", () => {
  const pagos = [
    makePago({ id: 1, estadoPago: "APROBADO" }),
    makePago({ id: 2, estadoPago: "PENDIENTE_VALIDACION" }),
    makePago({ id: 3, estadoPago: "RECHAZADO" }),
    makePago({ id: 4, estadoPago: "APROBADO" }),
  ];

  it("returns all when filter is TODOS", () => {
    expect(filterPagosByStatus(pagos, "TODOS")).toHaveLength(4);
  });

  it("filters APROBADO", () => {
    const result = filterPagosByStatus(pagos, "APROBADO");
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.estadoPago === "APROBADO")).toBe(true);
  });

  it("filters PENDIENTE_VALIDACION", () => {
    const result = filterPagosByStatus(pagos, "PENDIENTE_VALIDACION");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it("filters RECHAZADO", () => {
    const result = filterPagosByStatus(pagos, "RECHAZADO");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it("returns empty array when no match", () => {
    const result = filterPagosByStatus([], "APROBADO");
    expect(result).toHaveLength(0);
  });
});

describe("sortPagosByDate", () => {
  it("sorts newest first by fechaRegistro", () => {
    const pagos = [
      makePago({ id: 1, fechaRegistro: "2026-06-01T10:00:00" }),
      makePago({ id: 2, fechaRegistro: "2026-07-15T10:00:00" }),
      makePago({ id: 3, fechaRegistro: "2026-07-01T10:00:00" }),
    ];
    const sorted = sortPagosByDate(pagos);
    expect(sorted.map((p) => p.id)).toEqual([2, 3, 1]);
  });

  it("does not mutate the original array", () => {
    const pagos = [
      makePago({ id: 1, fechaRegistro: "2026-06-01T10:00:00" }),
      makePago({ id: 2, fechaRegistro: "2026-07-15T10:00:00" }),
    ];
    sortPagosByDate(pagos);
    expect(pagos[0].id).toBe(1);
  });
});

describe("formatPagoMonto", () => {
  it("renders the amount in the product's single currency grammar", () => {
    // Not `$35.00`: this screen used to be the second currency format in the
    // product, so a parent comparing it with the carnet's `$25,00` saw two
    // different notations for the same kind of number.
    expect(formatPagoMonto("35.00")).toBe("$35,00");
  });

  it("survives an amount the backend sends without decimals", () => {
    expect(formatPagoMonto("40")).toBe("$40,00");
  });

  it("renders a missing amount as zero rather than as `$NaN`", () => {
    expect(formatPagoMonto("")).toBe("$0,00");
  });
});

describe("getEmptyStateMessage", () => {
  const cases: [PagoStatusFilter, string][] = [
    ["TODOS", "Todavía no hay pagos registrados."],
    ["APROBADO", "No hay pagos aprobados."],
    ["RECHAZADO", "No hay pagos rechazados."],
    ["PENDIENTE_VALIDACION", "No hay pagos pendientes de validación."],
  ];

  it.each(cases)("returns correct message for %s", (filter, expected) => {
    expect(getEmptyStateMessage(filter)).toBe(expected);
  });
});

describe("describePagoEstado", () => {
  it("reads an approved payment as ok", () => {
    expect(describePagoEstado("APROBADO")).toEqual({ label: "Aprobado", tone: "ok" });
  });

  it("reads a rejected payment as bad — this is the one the student must act on", () => {
    expect(describePagoEstado("RECHAZADO")).toEqual({ label: "Rechazado", tone: "bad" });
  });

  it("reads a payment awaiting validation as warn, not as an error", () => {
    // Waiting for the club to check a voucher is the normal path, so it must
    // not wear the same colour as a rejection.
    expect(describePagoEstado("PENDIENTE_VALIDACION")).toEqual({
      label: "Pendiente de validación",
      tone: "warn",
    });
  });
});

describe("pagoFaltaComprobante", () => {
  it("marks a pending transfer with no voucher — the payment a failed upload leaves behind (PAG-1)", () => {
    const pago = makePago({ tipoPago: "TRANSFERENCIA", estadoPago: "PENDIENTE_VALIDACION", voucherUrl: null });
    expect(pagoFaltaComprobante(pago)).toBe(true);
  });

  it("does not mark a pending transfer that already has its voucher", () => {
    const pago = makePago({
      tipoPago: "TRANSFERENCIA",
      estadoPago: "PENDIENTE_VALIDACION",
      voucherUrl: "https://cataclub.example/vouchers/1",
    });
    expect(pagoFaltaComprobante(pago)).toBe(false);
  });

  it("does not mark a cash payment — EFECTIVO never needs a voucher", () => {
    const pago = makePago({ tipoPago: "EFECTIVO", estadoPago: "PENDIENTE_VALIDACION", voucherUrl: null });
    expect(pagoFaltaComprobante(pago)).toBe(false);
  });

  it.each(["APROBADO", "RECHAZADO"] as const)(
    "does not mark a %s transfer — it already carries its own resolution",
    (estadoPago) => {
      const pago = makePago({ tipoPago: "TRANSFERENCIA", estadoPago, voucherUrl: null });
      expect(pagoFaltaComprobante(pago)).toBe(false);
    },
  );
});

describe("wholeMonthsFor", () => {
  it("resolves an exact multiple of the monthly price", () => {
    expect(wholeMonthsFor(75, 25)).toBe(3);
    expect(wholeMonthsFor(25, 25)).toBe(1);
  });

  it("rejects an amount that is not a whole number of months", () => {
    // The old form truncated this to 1 month while submitting $37,50.
    expect(wholeMonthsFor(37.5, 25)).toBeNull();
  });

  it("accepts a multiple that binary floating point cannot divide exactly", () => {
    // 40.8 / 13.6 === 2.9999999999999996 — a strict `% !== 0` rejects it.
    expect(wholeMonthsFor(40.8, 13.6)).toBe(3);
  });

  it("rejects an amount the old 0.001 tolerance let through as a false 2 months", () => {
    // $49,99 against a $25 quota: 49.99 / 25 = 1.9996, within the old 0.001
    // band of 2 — the preview said "2 meses" and the backend's exact
    // `Decimal` modulo (membresia_pago_servicio.py:308) then rejected it.
    expect(wholeMonthsFor(49.99, 25)).toBeNull();
  });

  it("rejects amounts just below and just above an exact multiple", () => {
    expect(wholeMonthsFor(24.99, 25)).toBeNull();
    expect(wholeMonthsFor(25.01, 25)).toBeNull();
  });

  it("resolves an amount with legitimate cents that lands exactly on a multiple", () => {
    expect(wholeMonthsFor(13.75, 13.75)).toBe(1);
    expect(wholeMonthsFor(27.5, 13.75)).toBe(2);
  });

  it("returns null for a zero or unknown monthly price rather than dividing by it", () => {
    expect(wholeMonthsFor(50, 0)).toBeNull();
    expect(wholeMonthsFor(0, 25)).toBeNull();
    expect(wholeMonthsFor(Number.NaN, 25)).toBeNull();
  });

  it("returns null for a negative amount", () => {
    expect(wholeMonthsFor(-25, 25)).toBeNull();
  });

  it("does not falsely accept an enormous amount past safe-integer precision", () => {
    // Beyond Number.MAX_SAFE_INTEGER cents, integer arithmetic on the
    // amount's cent value can no longer be trusted — reject instead of
    // guessing, the same way the client should never promise a period the
    // backend cannot verify.
    expect(wholeMonthsFor(Number.MAX_SAFE_INTEGER, 25)).toBeNull();
  });

  it("still resolves a large but safely representable multiple", () => {
    expect(wholeMonthsFor(2_500_000, 25)).toBe(100_000);
  });
});

describe("addMonthsIso", () => {
  it("adds whole months within a month of the same length", () => {
    expect(addMonthsIso("2026-07-01", 1)).toBe("2026-08-01");
    expect(addMonthsIso("2026-01-15", 3)).toBe("2026-04-15");
  });

  it("clamps to the last day of the target month instead of rolling into the next one", () => {
    // `new Date("2026-08-31").setMonth(+1)` is 1 October — a renewal starting
    // the day the previous period ended used to land a day into the wrong
    // month.
    expect(addMonthsIso("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("crosses a year boundary", () => {
    expect(addMonthsIso("2026-11-30", 2)).toBe("2027-01-30");
  });

  it("returns an empty string for an unparseable date rather than 'Invalid Date'", () => {
    expect(addMonthsIso("", 1)).toBe("");
    expect(addMonthsIso("not-a-date", 1)).toBe("");
  });
});

describe("countPagosByStatus", () => {
  it("counts every filter bucket in a single pass", () => {
    const counts = countPagosByStatus([
      makePago({ id: 1, estadoPago: "APROBADO" }),
      makePago({ id: 2, estadoPago: "APROBADO" }),
      makePago({ id: 3, estadoPago: "RECHAZADO" }),
      makePago({ id: 4, estadoPago: "PENDIENTE_VALIDACION" }),
    ]);
    expect(counts).toEqual({
      TODOS: 4,
      PENDIENTE_VALIDACION: 1,
      APROBADO: 2,
      RECHAZADO: 1,
    });
  });

  it("returns a zeroed record for an empty history", () => {
    expect(countPagosByStatus([])).toEqual({
      TODOS: 0,
      PENDIENTE_VALIDACION: 0,
      APROBADO: 0,
      RECHAZADO: 0,
    });
  });
});
