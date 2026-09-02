/**
 * Unit tests for the Reportes page pagination helpers.
 *
 * Pure functions — no React dependencies. Pattern follows
 * members-utils.test.ts / attendance-utils.test.ts.
 */

import { describe, it, expect } from "vitest";
import type { PersonaReporte, EstadoAsistencia } from "@/types/domain";
import type { AttendanceRecord } from "@/app/attendance/attendance-utils";
import type { PaymentValidationRequest } from "@/services/api";
import {
  PERSONA_REPORT_PAGE_SIZE,
  paginatePersonaResults,
  getPersonaReportTotalPages,
  ASISTENCIA_REPORT_PAGE_SIZE,
  paginateAsistenciaResults,
  getAsistenciaReportTotalPages,
  PAGOS_REPORT_PAGE_SIZE,
  paginatePagosResults,
  getPagosReportTotalPages,
  buildReportDateRange,
  REPORT_DATE_PRESETS,
} from "../reports-utils";

function buildPersonas(count: number): PersonaReporte[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    nombres: `Nombre ${i}`,
    apellidos: `Apellido ${i}`,
    cedula: `000${i}`,
    fechaNacimiento: "2010-01-01",
    telefono: "0999999999",
  }));
}

function buildAsistencia(count: number): AttendanceRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `rec-${i}`,
    fecha: "2026-07-01",
    horario: "Test",
    horarioId: 1,
    personaId: i,
    estudiante: `Student ${i}`,
    estado: "present" as EstadoAsistencia,
    entrenador: "Trainer X",
  }));
}

function buildPagos(count: number): PaymentValidationRequest[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `pago-${i}`,
    studentName: `Student ${i}`,
    membershipPeriod: "2026-07-01 – 2026-07-31",
    membershipType: "Adultos (18:00-19:00)",
    expectedAmount: 35,
    paymentMethod: "Transferencia",
    uploadedAt: "2026-07-01T09:00:00Z",
    currentMembershipStatus: "activa",
    proofFileType: "image",
    validationStatus: "pendiente",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  }));
}

describe("paginatePersonaResults / getPersonaReportTotalPages", () => {
  it("uses a page size of 10", () => {
    expect(PERSONA_REPORT_PAGE_SIZE).toBe(10);
  });

  it("slices results to the page size for page 1, and the remainder for a later page", () => {
    const personas = buildPersonas(25);
    const page1 = paginatePersonaResults(personas, 1);
    expect(page1).toHaveLength(10);
    expect(page1[0].id).toBe(0);
    expect(page1[9].id).toBe(9);

    const page3 = paginatePersonaResults(personas, 3);
    expect(page3).toHaveLength(5);
    expect(page3[0].id).toBe(20);
  });

  it("returns an empty array for a page beyond the data", () => {
    expect(paginatePersonaResults(buildPersonas(5), 5)).toEqual([]);
  });

  it("rounds up to a whole page count, floored at 1 (never 0 pages)", () => {
    expect(getPersonaReportTotalPages(25)).toBe(3);
    expect(getPersonaReportTotalPages(10)).toBe(1);
    expect(getPersonaReportTotalPages(0)).toBe(1);
  });
});

describe("paginateAsistenciaResults / getAsistenciaReportTotalPages", () => {
  it("uses a page size of 10", () => {
    expect(ASISTENCIA_REPORT_PAGE_SIZE).toBe(10);
  });

  it("slices results to the page size for page 1, and the remainder for a later page", () => {
    const records = buildAsistencia(22);
    const page1 = paginateAsistenciaResults(records, 1);
    expect(page1).toHaveLength(10);
    expect(page1[0].id).toBe("rec-0");

    const page3 = paginateAsistenciaResults(records, 3);
    expect(page3).toHaveLength(2);
    expect(page3[0].id).toBe("rec-20");
  });

  it("returns an empty array for a page beyond the data", () => {
    expect(paginateAsistenciaResults(buildAsistencia(5), 5)).toEqual([]);
  });

  it("rounds up to a whole page count, floored at 1 (never 0 pages)", () => {
    expect(getAsistenciaReportTotalPages(22)).toBe(3);
    expect(getAsistenciaReportTotalPages(10)).toBe(1);
    expect(getAsistenciaReportTotalPages(0)).toBe(1);
  });
});

describe("paginatePagosResults / getPagosReportTotalPages", () => {
  it("uses a page size of 10", () => {
    expect(PAGOS_REPORT_PAGE_SIZE).toBe(10);
  });

  it("slices results to the page size for page 1, and the remainder for a later page", () => {
    const pagos = buildPagos(23);
    const page1 = paginatePagosResults(pagos, 1);
    expect(page1).toHaveLength(10);
    expect(page1[0].id).toBe("pago-0");

    const page3 = paginatePagosResults(pagos, 3);
    expect(page3).toHaveLength(3);
    expect(page3[0].id).toBe("pago-20");
  });

  it("returns an empty array for a page beyond the data", () => {
    expect(paginatePagosResults(buildPagos(5), 5)).toEqual([]);
  });

  it("rounds up to a whole page count, floored at 1 (never 0 pages)", () => {
    expect(getPagosReportTotalPages(23)).toBe(3);
    expect(getPagosReportTotalPages(10)).toBe(1);
    expect(getPagosReportTotalPages(0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Quick date-range presets (issue #201)
// ---------------------------------------------------------------------------
//
// The CSV export tests that used to live here (`csvField`/`toCsv`/
// `csvFilename`) moved to `xlsx-export.test.ts` (issue #864).

describe("REPORT_DATE_PRESETS", () => {
  it("offers exactly the six presets the issue names, in the funnel order", () => {
    expect(REPORT_DATE_PRESETS.map((p) => p.key)).toEqual([
      "today",
      "this_week",
      "this_month",
      "last_3_months",
      "full_history",
      "custom",
    ]);
    expect(REPORT_DATE_PRESETS.map((p) => p.label)).toEqual([
      "Hoy",
      "Esta semana",
      "Este mes",
      "Últimos 3 meses",
      "Histórico completo",
      "Personalizado",
    ]);
  });
});

describe("buildReportDateRange", () => {
  const WEDNESDAY = new Date("2026-08-12T15:00:00Z"); // clubIsoDate → 2026-08-12

  it("delegates today/this_week/this_month/custom to the shared buildDateRange", () => {
    expect(buildReportDateRange("today", WEDNESDAY)).toEqual({
      fechaInicio: "2026-08-12",
      fechaFin: "2026-08-12",
    });
    expect(buildReportDateRange("this_month", WEDNESDAY)).toEqual({
      fechaInicio: "2026-08-01",
      fechaFin: "2026-08-12",
    });
    expect(buildReportDateRange("custom", WEDNESDAY)).toEqual({ fechaInicio: "", fechaFin: "" });
  });

  it("resolves 'últimos 3 meses' to the first day of the month two months back", () => {
    expect(buildReportDateRange("last_3_months", WEDNESDAY)).toEqual({
      fechaInicio: "2026-06-01",
      fechaFin: "2026-08-12",
    });
  });

  it("crosses a year boundary when the 3-month window reaches back into the prior year", () => {
    const january = new Date("2026-01-15T15:00:00Z");
    expect(buildReportDateRange("last_3_months", january)).toEqual({
      fechaInicio: "2025-11-01",
      fechaFin: "2026-01-15",
    });
  });

  it("resolves 'histórico completo' to the club's founding date, never an open range", () => {
    expect(buildReportDateRange("full_history", WEDNESDAY)).toEqual({
      fechaInicio: "2013-10-10",
      fechaFin: "2026-08-12",
    });
  });
});
