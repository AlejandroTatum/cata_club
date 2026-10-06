import { describe, expect, it } from "vitest";
import { formatNoClassRange, isNoClassDate, upcomingNoClassDays } from "../no-class-days";

const single = { fechaInicio: "2029-07-04", fechaFin: "2029-07-04" };
const range = { fechaInicio: "2029-07-10", fechaFin: "2029-07-12" };

describe("no-class day helpers", () => {
  it("formats a single day and a range with the product date grammar", () => {
    expect(formatNoClassRange(single)).toBe("04/07/2029");
    expect(formatNoClassRange(range)).toBe("10/07/2029 – 12/07/2029");
  });

  it("covers both ends of a range and nothing outside it", () => {
    const days = [single, range];
    for (const fecha of ["2029-07-04", "2029-07-10", "2029-07-11", "2029-07-12"]) {
      expect(isNoClassDate(fecha, days)).toBe(true);
    }
    for (const fecha of ["2029-07-03", "2029-07-05", "2029-07-09", "2029-07-13"]) {
      expect(isNoClassDate(fecha, days)).toBe(false);
    }
    expect(isNoClassDate("2029-07-04", [])).toBe(false);
  });

  it("keeps a day that ends today, drops one that ended, and sorts soonest first", () => {
    const ended = { fechaInicio: "2029-06-01", fechaFin: "2029-06-02" };
    const today = { fechaInicio: "2029-06-14", fechaFin: "2029-06-14" };
    expect(upcomingNoClassDays([range, ended, today], "2029-06-14")).toEqual([today, range]);
  });
});
