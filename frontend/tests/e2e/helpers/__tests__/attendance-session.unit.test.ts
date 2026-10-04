import { describe, expect, it } from "vitest";
import { clubIsoDate } from "../attendance-session";

describe("clubIsoDate", () => {
  it("uses the club calendar day (UTC-5), not the UTC day", () => {
    // 03:00 UTC on the 5th is still 22:00 on the 4th in Guayaquil.
    expect(clubIsoDate(0, new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-04");
    expect(clubIsoDate(0, new Date("2026-10-05T05:00:00Z"))).toBe("2026-10-05");
  });

  it("counts days back across a month boundary", () => {
    expect(clubIsoDate(30, new Date("2026-10-04T12:00:00Z"))).toBe("2026-09-04");
    expect(clubIsoDate(5, new Date("2026-03-03T12:00:00Z"))).toBe("2026-02-26");
  });
});
