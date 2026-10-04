/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DayTabs from "../DayTabs";

describe("DayTabs — touch targets (ENT-14)", () => {
  it("gives every day chip a 44px minimum height", () => {
    render(<DayTabs daysWithSchedules={new Set(["lun"])} active="lun" today="lun" onSelect={vi.fn()} />);

    for (const chip of screen.getAllByRole("button")) {
      expect(chip.className).toContain("min-h-[44px]");
    }
  });
});
