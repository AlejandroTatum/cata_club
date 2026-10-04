import { describe, expect, it } from "vitest";
import { attendanceRatePercent, attendedCount, countsAsAttended } from "../attendance-rule";

describe("countsAsAttended", () => {
  it("counts presente and tardanza as attendance", () => {
    expect(countsAsAttended("present")).toBe(true);
    expect(countsAsAttended("late")).toBe(true);
  });

  it("does not count ausente, enfermo or competencia as attendance", () => {
    expect(countsAsAttended("absent")).toBe(false);
    expect(countsAsAttended("sick")).toBe(false);
    expect(countsAsAttended("competition")).toBe(false);
  });
});

describe("attendedCount", () => {
  it("adds presente and tardanza and ignores the rest", () => {
    expect(attendedCount({ present: 253, late: 107, absent: 200, sick: 30, competition: 29 })).toBe(360);
  });

  it("tolerates missing states", () => {
    expect(attendedCount({ present: 2 })).toBe(2);
    expect(attendedCount({})).toBe(0);
  });
});

describe("attendanceRatePercent", () => {
  it("is the rounded share of the whole record count (the Asistencias screen's 58 %)", () => {
    expect(attendanceRatePercent(360, 619)).toBe(58);
  });

  it("is 0, never NaN, with no records", () => {
    expect(attendanceRatePercent(0, 0)).toBe(0);
  });
});
