/**
 * Tests for shared formatting utilities (formatCurrency, formatDate,
 * formatDateShort, formatDateTime, formatDateRange).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
// formatDate — a UTC-midnight full ISO timestamp in a UTC-negative timezone
// (issue #1212: the membership card showed "Socio desde" one day early).
// A date-only or noon-UTC fixture never exercises this: it takes a real full
// ISO timestamp whose time-of-day happens to be exactly UTC midnight, read
// back in a timezone behind UTC.
// ---------------------------------------------------------------------------

describe("formatDate — UTC-midnight ISO timestamp in a UTC-negative timezone", () => {
  const originalTZ = process.env.TZ;

  beforeEach(() => {
    // America/Montevideo is UTC-3 year-round (no DST), so the offset is
    // deterministic regardless of when this suite runs.
    process.env.TZ = "America/Montevideo";
  });

  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it("renders the activation day, not the day before, for a UTC-midnight timestamp", () => {
    // "2026-09-14T00:00:00Z" is 2026-09-13T21:00:00-03:00 in Montevideo.
    // Reading it back with local getters (`getDate()`/`getMonth()`) — the
    // bug this test guards against — renders "13/09/2026". The activation
    // was on the 14th; the card must say "14/09/2026".
    expect(formatDate("2026-09-14T00:00:00Z")).toBe("14/09/2026");
  });

  it("still crosses days for a genuine non-midnight instant", () => {
    // 02:00 UTC is 23:00 the PREVIOUS day in Montevideo — a real instant,
    // not a calendar-date marker, so the guard above must not swallow it.
    expect(formatDate("2026-09-14T02:00:00Z")).toBe("13/09/2026");
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
