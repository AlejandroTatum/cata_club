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
  csvField,
  csvFilename,
  toCsv,
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
    proofFileName: "voucher.jpg",
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
// CSV export
// ---------------------------------------------------------------------------

describe("csvField", () => {
  it("leaves an ordinary value untouched", () => {
    expect(csvField("Ana Vera")).toBe("Ana Vera");
    expect(csvField(42)).toBe("42");
  });

  it("renders null and undefined as an empty field, never as the word", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes and doubles embedded quotes, commas and newlines", () => {
    expect(csvField('Ana "La Zurda" Vera')).toBe('"Ana ""La Zurda"" Vera"');
    expect(csvField("Vera, Ana")).toBe('"Vera, Ana"');
    expect(csvField("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
  });

  it("neutralises a value a spreadsheet would evaluate as a formula", () => {
    // The CSV-injection foothold: without the leading quote Excel runs these.
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("+34600000000")).toBe("'+34600000000");
    expect(csvField("-5")).toBe("'-5");
    expect(csvField("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
  });
});

describe("toCsv", () => {
  it("writes the header first, then one CRLF-terminated line per row", () => {
    const csv = toCsv(["Nombre", "Edad"], [
      ["Ana", 12],
      ["Luis", 9],
    ]);

    expect(csv.endsWith("\r\n")).toBe(true);
    // Strip the BOM before comparing the text itself.
    expect(csv.slice(1)).toBe("Nombre,Edad\r\nAna,12\r\nLuis,9\r\n");
  });

  it("starts with a UTF-8 BOM so Excel reads the accents", () => {
    expect(toCsv(["Cédula"], [["Ordóñez"]]).charCodeAt(0)).toBe(0xfeff);
  });

  it("still produces a header when there are no rows", () => {
    expect(toCsv(["Nombre"], []).slice(1)).toBe("Nombre\r\n");
  });
});

describe("csvFilename", () => {
  it("mirrors the backend's PDF naming, zero-padded", () => {
    expect(csvFilename("periodo", new Date(2026, 6, 5))).toBe("reporte-periodo_2026-07-05.csv");
  });
});
