/**
 * Tests for shared formatting utilities (formatCurrency, formatDate,
 * formatDateShort, formatDateTime, formatDateRange).
 */

import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDateRange,
  joinWithY,
} from "../format-utils";

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------

describe("formatCurrency", () => {
  it("formats whole dollars with two decimal places", () => {
    expect(formatCurrency(85)).toMatch(/^\$\d+,\d{2}$/);
  });

  it("formats cents correctly", () => {
    expect(formatCurrency(240.5)).toMatch(/^\$\d+,\d{2}$/);
    expect(formatCurrency(720)).toMatch(/^\$\d+,\d{2}$/);
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0,00");
  });

  it("handles NaN gracefully", () => {
    expect(formatCurrency(NaN)).toBe("$0,00");
  });

  it("handles Infinity and -Infinity gracefully", () => {
    expect(formatCurrency(Infinity)).toBe("$0,00");
    expect(formatCurrency(-Infinity)).toBe("$0,00");
  });

  it("coerces numeric strings so raw API values never leak a second format", () => {
    expect(formatCurrency("24")).toBe("$24,00");
    expect(formatCurrency("24.5")).toBe("$24,50");
  });

  it("returns the zero placeholder for null/undefined", () => {
    expect(formatCurrency(null)).toBe("$0,00");
    expect(formatCurrency(undefined)).toBe("$0,00");
  });
});

// ---------------------------------------------------------------------------
// formatDate — the single canonical dd/mm/yyyy rendering
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  it("returns empty string for empty input", () => {
    expect(formatDate("")).toBe("");
  });

  it("returns empty string for invalid date string", () => {
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDate("2026-13-01")).toBe("");
    expect(formatDate("2021-02-29")).toBe("");
  });

  it("renders dd/mm/yyyy with zero padding", () => {
    expect(formatDate("2014-03-15")).toBe("15/03/2014");
    expect(formatDate("2026-06-08")).toBe("08/06/2026");
  });

  it("renders a full ISO timestamp as dd/mm/yyyy", () => {
    expect(formatDate("2026-06-28T10:30:00Z")).toBe("28/06/2026");
  });

  it("keeps a date-only string on its own calendar day (America/Guayaquil is UTC-5)", () => {
    // Anchored at noon UTC: never rolls back to the previous day.
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
    expect(formatDate("2026-12-31")).toBe("31/12/2026");
  });
});

// ---------------------------------------------------------------------------
// formatDateShort — same grammar, two-digit year, for dense table cells
// ---------------------------------------------------------------------------

describe("formatDateShort", () => {
  it("returns empty string for empty or invalid input", () => {
    expect(formatDateShort("")).toBe("");
    expect(formatDateShort("not-a-date")).toBe("");
  });

  it("renders dd/mm/yy", () => {
    expect(formatDateShort("2014-03-15")).toBe("15/03/14");
    expect(formatDateShort("2026-06-08")).toBe("08/06/26");
  });

  it("uses the same day/month digits as formatDate", () => {
    expect(formatDateShort("2026-06-28T10:30:00Z")).toBe("28/06/26");
  });
});

// ---------------------------------------------------------------------------
// formatDateTime
// ---------------------------------------------------------------------------

describe("formatDateTime", () => {
  it("returns empty string for empty input", () => {
    expect(formatDateTime("")).toBe("");
  });

  it("returns empty string for invalid date string", () => {
    expect(formatDateTime("not-a-date")).toBe("");
    expect(formatDateTime("2026-13-01")).toBe("");
  });

  it("renders the date part in the same dd/mm/yyyy grammar as formatDate", () => {
    const result = formatDateTime("2026-06-28T10:30:00Z");
    expect(result.startsWith("28/06/2026 · ")).toBe(true);
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}$/);
  });

  it("renders time in 24-hour form", () => {
    const result = formatDateTime("2026-06-28T14:15:00Z");
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// formatDateRange
// ---------------------------------------------------------------------------

describe("formatDateRange", () => {
  it("joins two dates with an en dash", () => {
    expect(formatDateRange("2026-07-01", "2026-08-12")).toBe("01/07/2026 – 12/08/2026");
  });

  it("falls back to whichever side is present", () => {
    expect(formatDateRange("2026-07-01", "")).toBe("01/07/2026");
    expect(formatDateRange("", "2026-08-12")).toBe("12/08/2026");
  });

  it("returns an empty string when neither side is a date", () => {
    expect(formatDateRange("", "")).toBe("");
    expect(formatDateRange("nope", "nope")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// joinWithY
// ---------------------------------------------------------------------------

describe("joinWithY", () => {
  it("returns the single item untouched", () => {
    expect(joinWithY(["Ana Pérez"])).toBe("Ana Pérez");
  });

  it("joins two items with y, and no comma", () => {
    expect(joinWithY(["Ana Pérez", "Luis Pérez"])).toBe("Ana Pérez y Luis Pérez");
  });

  it("commas every item but the last, which takes the y", () => {
    expect(joinWithY(["Lunes", "miércoles", "viernes"])).toBe("Lunes, miércoles y viernes");
  });

  it("returns an empty string for an empty list, so a caller can test for it", () => {
    // The alternative — a stray "y" or a lone comma — is the shape this
    // function exists to make impossible.
    expect(joinWithY([])).toBe("");
  });

  it("drops blank entries instead of rendering a gap around them", () => {
    expect(joinWithY(["Ana Pérez", "", "Luis Pérez"])).toBe("Ana Pérez y Luis Pérez");
  });
});
