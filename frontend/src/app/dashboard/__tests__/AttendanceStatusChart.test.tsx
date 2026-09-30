/**
 * The donut and its legend share a row from `sm` up. Stacked, the card was
 * ~100px taller than the activity feed beside it and left a blank band there.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AttendanceStatusChart from "../AttendanceStatusChart";
import type { AttendanceDayStats } from "@/app/attendance/attendance-utils";

const STATS: AttendanceDayStats = {
  totalPresent: 6,
  totalAbsent: 2,
  totalLate: 1,
  totalJustified: 1,
  totalSick: 0,
  totalCompetition: 0,
  totalUnknown: 0,
  totalStudents: 10,
};

describe("AttendanceStatusChart", () => {
  it("lays the donut beside the legend on wide cards and stacks them on a phone", () => {
    render(<AttendanceStatusChart stats={STATS} />);

    const root = screen.getByRole("img").parentElement!;
    expect(root.className).toMatch(/\bsm:flex-row\b/);
    expect(root.className).toMatch(/\bflex-col\b/);
    expect(screen.getByRole("table").className).toMatch(/\bflex-1\b/);
  });
});
