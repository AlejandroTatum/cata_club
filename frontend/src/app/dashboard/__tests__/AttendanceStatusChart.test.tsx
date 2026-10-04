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
  totalSick: 0,
  totalCompetition: 0,
  totalUnknown: 0,
  totalStudents: 10,
};

describe("AttendanceStatusChart", () => {
  it("stacks the donut above the legend at rail width, centred, at every viewport", () => {
    render(<AttendanceStatusChart stats={STATS} />);

    const root = screen.getByRole("img").parentElement!;
    expect(root.className).toMatch(/\bflex-col\b/);
    expect(root.className).toMatch(/\bitems-center\b/);
    expect(root.className).not.toMatch(/\bsm:flex-row\b/);
    expect(screen.getByRole("table").className).toMatch(/\bw-full\b/);
  });
});
