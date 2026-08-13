/**
 * Unit tests for `calculatePersonAge` (`@/lib/identity-validation`), exercised
 * through this file's exhaustive edge-case list. `enroll-utils.ts` used to
 * re-export the function as `calculateAge`; now that every caller imports
 * `calculatePersonAge` directly (no shim left to test through), this suite
 * imports it the same way.
 *
 * Pure function — no React dependencies, easy to test.
 *
 * All tests are deterministic: they pass a fixed `today` reference date
 * instead of relying on `new Date()`, so they never go stale.
 */

import { describe, it, expect } from "vitest";
import { calculatePersonAge as calculateAge } from "@/lib/identity-validation";

/** Fixed reference date for all deterministic tests — July 1, 2026. */
const TODAY = new Date(2026, 6, 1); // month is 0-indexed: 6 = July

describe("calculateAge", () => {
  // -----------------------------------------------------------------------
  // Happy path — deterministic
  // -----------------------------------------------------------------------

  it("returns 0 for birth date equal to today", () => {
    expect(calculateAge("2026-07-01", TODAY)).toBe(0);
  });

  it("returns correct age for a birth date exactly N years ago", () => {
    expect(calculateAge("2008-07-01", TODAY)).toBe(18);
  });

  it("returns 17 when birthday is tomorrow", () => {
    // Born 2008-07-02 → 18th birthday is 2026-07-02 (tomorrow from TODAY)
    expect(calculateAge("2008-07-02", TODAY)).toBe(17);
  });

  it("returns 18 when birthday is today (exact)", () => {
    expect(calculateAge("2008-07-01", TODAY)).toBe(18);
  });

  it("returns N-1 when birthday has not yet occurred this year", () => {
    // Born 1990-12-31 → last birthday was Dec 2025 → age = 35
    expect(calculateAge("1990-12-31", TODAY)).toBe(35);
  });

  it("handles leap year birth dates deterministically", () => {
    // Born 2000-02-29, as of 2026-07-01 they are 26 (not yet Feb 2027)
    expect(calculateAge("2000-02-29", TODAY)).toBe(26);
  });

  it("returns correct age in early January for December birthday", () => {
    // Born 1990-12-25, evaluated on 2026-01-15 → still 35 (35th was Dec 2025)
    const jan15 = new Date(2026, 0, 15);
    expect(calculateAge("1990-12-25", jan15)).toBe(35);
  });

  it("returns correct age in early January for January birthday after today", () => {
    // Born 1991-01-10, evaluated on 2026-01-05 → still 34 (35th is Jan 10)
    const jan5 = new Date(2026, 0, 5);
    expect(calculateAge("1991-01-10", jan5)).toBe(34);
  });

  it("returns correct age on exact birthday in January", () => {
    // Born 1991-01-10, evaluated on 2026-01-10 → 35
    const jan10 = new Date(2026, 0, 10);
    expect(calculateAge("1991-01-10", jan10)).toBe(35);
  });

  // -----------------------------------------------------------------------
  // Invalid / edge input — safe contract
  // -----------------------------------------------------------------------

  it("returns NaN for empty string", () => {
    expect(calculateAge("", TODAY)).toBeNaN();
  });

  it("returns NaN for malformed string without dashes", () => {
    expect(calculateAge("abc", TODAY)).toBeNaN();
  });

  it("returns NaN for partially numeric string", () => {
    expect(calculateAge("2026-07", TODAY)).toBeNaN();
  });

  it("returns NaN for overflow month (13)", () => {
    expect(calculateAge("2026-13-01", TODAY)).toBeNaN();
  });

  it("returns NaN for overflow day (32)", () => {
    expect(calculateAge("2026-07-32", TODAY)).toBeNaN();
  });

  it("returns NaN for month zero", () => {
    expect(calculateAge("2026-00-15", TODAY)).toBeNaN();
  });

  it("returns NaN for whitespace-only string", () => {
    expect(calculateAge("   ", TODAY)).toBeNaN();
  });

  it("returns NaN for non-numeric tokens", () => {
    expect(calculateAge("20aa-07-01", TODAY)).toBeNaN();
  });

  // -----------------------------------------------------------------------
  // Calendar-invalid dates (days valid per range but not per month)
  // -----------------------------------------------------------------------

  it("returns NaN for Feb 31 (calendar-invalid)", () => {
    expect(calculateAge("2026-02-31", TODAY)).toBeNaN();
  });

  it("returns NaN for Apr 31 (calendar-invalid)", () => {
    expect(calculateAge("2026-04-31", TODAY)).toBeNaN();
  });

  it("returns NaN for Sep 31 (calendar-invalid)", () => {
    expect(calculateAge("2026-09-31", TODAY)).toBeNaN();
  });

  it("returns NaN for Jun 31 (calendar-invalid)", () => {
    expect(calculateAge("2026-06-31", TODAY)).toBeNaN();
  });

  it("accepts Feb 29 of a leap year", () => {
    expect(calculateAge("2024-02-29", TODAY)).toBe(2);
  });

  it("accepts Feb 29 of a century leap year (2000)", () => {
    expect(calculateAge("2000-02-29", TODAY)).toBe(26);
  });

  it("returns NaN for Feb 29 of a non-leap year", () => {
    expect(calculateAge("2025-02-29", TODAY)).toBeNaN();
  });

  // -----------------------------------------------------------------------
  // Root-cause candado: an implausible-but-real year must compute a real
  // age, never NaN. `NaN < 18`, `NaN > 74` and every other comparison
  // against NaN are `false`, so an old artificial year cap here let this
  // exact defect reach production three times through three separately
  // hand-rolled "uncapped" copies of this same function. This is the test
  // that goes red without the fix: before it, "1800-06-15" returned NaN,
  // and `calculateAge(...) < 18` silently reported a 226-year-old as valid.
  // -----------------------------------------------------------------------

  it("computes a real (large) age for a year before 1900, instead of NaN", () => {
    expect(calculateAge("1800-06-15", TODAY)).toBe(226);
  });

  it("computes a real age for a year the old cap rejected just past 1900", () => {
    expect(calculateAge("1899-06-15", TODAY)).toBe(127);
  });

  it("computes a real age for a year the old cap rejected past 2200", () => {
    // A birth date this far in the future is nonsensical for a real person,
    // but it's still a syntactically valid calendar date — plausibility is
    // the caller's domain rule (EDAD_MINIMA_ALUMNO/EDAD_MAXIMA_ALUMNO), not
    // this parser's. Comparisons against a real (negative) number still
    // behave correctly: -174 < 18 is true, so an age gate still catches it.
    expect(calculateAge("2300-06-15", TODAY)).toBe(-274);
  });

  it("still returns NaN for a year Date itself cannot represent", () => {
    // Genuinely unparseable — not a plausibility judgment. `new Date` cannot
    // represent this year at all, so its round trip fails the same way
    // Feb 31 does.
    expect(calculateAge("999999-06-15", TODAY)).toBeNaN();
  });
});
