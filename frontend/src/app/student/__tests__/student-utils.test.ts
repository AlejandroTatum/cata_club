/**
 * Unit tests for the student portal's pure helpers — no React dependencies.
 */

import { describe, it, expect } from "vitest";
import {
  derivePortalMode,
  isRepresentative,
  describeRanking,
  parseLevelNumber,
  personInitials,
  summarizeRecentAttendance,
  resolveMonthlyAmount,
  resolveCoverageEnd,
  findUploadablePago,
} from "../student-utils";
import type { MembershipSummary, PagoPersona, StudentRankingSummary, StudentSessionSummary } from "@/services/api";

// ---------------------------------------------------------------------------
// derivePortalMode / isRepresentative
// ---------------------------------------------------------------------------

describe("derivePortalMode", () => {
  it('returns "pending" when there is no ALUMNO role and no representados', () => {
    expect(derivePortalMode(false, 0)).toBe("pending");
  });

  it('returns "active" when there is an ALUMNO role, even with no representados', () => {
    expect(derivePortalMode(true, 0)).toBe("active");
  });

  it('returns "active" when there are representados, even with no ALUMNO role', () => {
    expect(derivePortalMode(false, 2)).toBe("active");
  });

  it('returns "active" when both an ALUMNO role and representados are present', () => {
    expect(derivePortalMode(true, 1)).toBe("active");
  });
});

describe("isRepresentative", () => {
  it("is false with zero representados", () => {
    expect(isRepresentative(0)).toBe(false);
  });

  it("is true with one or more representados", () => {
    expect(isRepresentative(1)).toBe(true);
    expect(isRepresentative(3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describeRanking
// ---------------------------------------------------------------------------

describe("describeRanking", () => {
  it("describes an unavailable/forbidden ranking", () => {
    const ranking: StudentRankingSummary = { status: "unavailable", reason: "forbidden" };
    const result = describeRanking(ranking);
    expect(result.label).toBe("No disponible");
    expect(result.tone).toBe("warn");
  });

  it("describes an unavailable/error ranking", () => {
    const ranking: StudentRankingSummary = { status: "unavailable", reason: "error" };
    expect(describeRanking(ranking).label).toBe("No disponible");
  });

  it("describes an available ranking with no nivel assigned yet", () => {
    const ranking: StudentRankingSummary = {
      status: "available",
      nivelNombre: null,
      estaEnRanking: false,
    };
    const result = describeRanking(ranking);
    expect(result.label).toBe("Sin nivel asignado");
    expect(result.tone).toBe("warn");
  });

  it("describes an active ranking without exposing position/points (removed — frozen data, no writer since cerrar_mes() removal)", () => {
    const ranking: StudentRankingSummary = {
      status: "available",
      nivelNombre: "Intermedios",
      estaEnRanking: true,
    };
    const result = describeRanking(ranking);
    expect(result.label).toBe("Intermedios");
    expect(result.detail).toBe("Activo en este nivel.");
    expect(result.detail).not.toMatch(/Posición|pts/);
    expect(result.tone).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// parseLevelNumber — the carnet's level chip
// ---------------------------------------------------------------------------

describe("parseLevelNumber", () => {
  it("reads the rung out of the backend's level name", () => {
    expect(parseLevelNumber("Nivel 9")).toBe(9);
    expect(parseLevelNumber("nivel 1")).toBe(1);
    expect(parseLevelNumber("10")).toBe(10);
  });

  it("returns null when there is no name at all", () => {
    expect(parseLevelNumber(null)).toBeNull();
    expect(parseLevelNumber("   ")).toBeNull();
  });

  it("returns null for a named level with no rung number — the chip must not invent one", () => {
    expect(parseLevelNumber("Intermedios")).toBeNull();
  });

  it("returns null for a rung outside the 1–10 ladder", () => {
    expect(parseLevelNumber("Nivel 0")).toBeNull();
    expect(parseLevelNumber("Nivel 11")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// personInitials — the avatar disc
// ---------------------------------------------------------------------------

describe("personInitials", () => {
  it("takes the first letter of the first given name and the first surname", () => {
    expect(personInitials("Ana Maria", "Garcia Lopez")).toBe("AG");
  });

  it("falls back to the given name alone when there is no surname", () => {
    expect(personInitials("Ana", "")).toBe("A");
  });

  it("returns an empty string when there is no name at all", () => {
    expect(personInitials("", "")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// summarizeRecentAttendance — the one real fact on the training panel
// ---------------------------------------------------------------------------

function session(estado: StudentSessionSummary["estado"], fecha: string): StudentSessionSummary {
  return { fecha, horario: "Lunes 15:00 — 16:00", estado };
}

describe("summarizeRecentAttendance", () => {
  it("returns null with no recorded sessions — there is no fact to state", () => {
    expect(summarizeRecentAttendance([])).toBeNull();
  });

  it("counts present and late as attended, absent and justified as missed", () => {
    const result = summarizeRecentAttendance([
      session("present", "2026-07-20"),
      session("late", "2026-07-18"),
      session("absent", "2026-07-15"),
      session("justified", "2026-07-13"),
    ]);
    expect(result).toEqual({ attended: 2, total: 4 });
  });

  it("reports a perfect record", () => {
    expect(summarizeRecentAttendance([session("present", "2026-07-20")])).toEqual({
      attended: 1,
      total: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveMonthlyAmount / resolveCoverageEnd / findUploadablePago
// ---------------------------------------------------------------------------

const MEMBRESIA: MembershipSummary = {
  id: 3,
  estado: "ACTIVA",
  personaId: 9,
  montoAplicado: "25.00",
  categoria: "Mensual",
  modalidad: "MENSUAL",
  franjaHoraria: "Tarde",
  fechaActivacion: "2026-03-15T00:00:00Z",
};

function pago(overrides: Partial<PagoPersona>): PagoPersona {
  return {
    id: 1,
    monto: "25.00",
    motivoRechazo: null,
    estadoPago: "PENDIENTE_VALIDACION",
    tipoPago: "TRANSFERENCIA",
    fechaRegistro: "2026-07-01T09:00:00Z",
    fechaValidacion: null,
    fechaInicio: "2026-07-01",
    fechaFin: "2026-07-31",
    personaId: 9,
    membresiaId: 3,
    voucherUrl: null,
    voucherFormato: null,
    ...overrides,
  };
}

describe("resolveMonthlyAmount", () => {
  it("resolves the amount from the persona's own membership row", () => {
    expect(resolveMonthlyAmount(MEMBRESIA)).toBe("25.00");
  });

  it("returns null when there is no membership — no figure may be invented", () => {
    expect(resolveMonthlyAmount(null)).toBeNull();
  });

  it("returns null when the membership carries no montoAplicado", () => {
    expect(resolveMonthlyAmount({ ...MEMBRESIA, montoAplicado: null })).toBeNull();
  });
});

describe("resolveCoverageEnd", () => {
  it("returns the furthest fechaFin among approved payments", () => {
    expect(
      resolveCoverageEnd([
        pago({ id: 1, estadoPago: "APROBADO", fechaFin: "2026-07-31" }),
        pago({ id: 2, estadoPago: "APROBADO", fechaFin: "2026-08-31" }),
      ]),
    ).toBe("2026-08-31");
  });

  it("ignores payments that are not approved — a pending one covers nothing yet", () => {
    expect(
      resolveCoverageEnd([
        pago({ id: 1, estadoPago: "APROBADO", fechaFin: "2026-07-31" }),
        pago({ id: 2, estadoPago: "PENDIENTE_VALIDACION", fechaFin: "2026-09-30" }),
        pago({ id: 3, estadoPago: "RECHAZADO", fechaFin: "2026-10-31" }),
      ]),
    ).toBe("2026-07-31");
  });

  it("returns null when nothing has been approved", () => {
    expect(resolveCoverageEnd([pago({ estadoPago: "PENDIENTE_VALIDACION" })])).toBeNull();
    expect(resolveCoverageEnd([])).toBeNull();
  });
});

describe("findUploadablePago", () => {
  it("finds the payment still waiting for a comprobante", () => {
    const target = pago({ id: 7 });
    expect(findUploadablePago([pago({ id: 6, estadoPago: "APROBADO" }), target])).toBe(target);
  });

  it("skips a payment that already carries a voucher", () => {
    expect(findUploadablePago([pago({ voucherUrl: "https://example.test/v.pdf" })])).toBeNull();
  });

  it("offers a rejected payment for re-upload", () => {
    const rejected = pago({ id: 8, estadoPago: "RECHAZADO", motivoRechazo: "Ilegible" });
    expect(findUploadablePago([rejected])).toBe(rejected);
  });

  it("returns null when there is nothing to upload", () => {
    expect(findUploadablePago([])).toBeNull();
    expect(findUploadablePago([pago({ estadoPago: "APROBADO" })])).toBeNull();
  });
});
