import { describe, it, expect } from "vitest";
import { ATTENDANCE_GOAL_PERCENT, attendanceTone } from "@/lib/attendance-tone";

describe("attendanceTone — the 75% goal", () => {
  it("states the goal the owner approved", () => {
    expect(ATTENDANCE_GOAL_PERCENT).toBe(75);
  });

  it("is green with a word at or above the goal", () => {
    expect(attendanceTone(75)).toEqual({ tone: "ok", status: "Buen ritmo" });
    expect(attendanceTone(100).tone).toBe("ok");
  });

  it("turns amber, with its own word, just under the goal", () => {
    expect(attendanceTone(74.9)).toEqual({ tone: "warn", status: "Bajo la meta de 75%" });
    expect(attendanceTone(0).tone).toBe("warn");
  });

  it("says nothing coloured when there is no figure yet", () => {
    expect(attendanceTone(null)).toEqual({ tone: "info", status: "Aún sin lista" });
  });
});
