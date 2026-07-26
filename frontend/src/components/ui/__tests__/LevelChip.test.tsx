/**
 * LevelChip — the l1–l10 ramp. Level 1 is the top of the ladder, 10 the base,
 * and the chip carries rank and nothing else: no occupancy, no minimums, no
 * "N/M" fraction. That is a settled product decision, so it gets a test.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LevelChip, { LEVELS, isLevel, type Level } from "@/components/ui/LevelChip";

function chipFor(level: Level): HTMLElement {
  const { container } = render(<LevelChip level={level} />);
  return container.firstElementChild as HTMLElement;
}

describe("LevelChip — the ramp", () => {
  it("paints every rung with its own ramp step", () => {
    for (const level of LEVELS) {
      const { container, unmount } = render(<LevelChip level={level} />);
      expect(container.firstElementChild).toHaveClass(`bg-l${level}`);
      unmount();
    }
  });

  it("gives level 1 the ball as its foreground — the only rung that gets it", () => {
    expect(chipFor(1)).toHaveClass("text-ball");
  });

  it("uses white on the dark middle rungs and ink on the light ones", () => {
    for (const level of [2, 3, 4, 5, 6, 7] as const) {
      const { container, unmount } = render(<LevelChip level={level} />);
      expect(container.firstElementChild).toHaveClass("text-white");
      unmount();
    }
    for (const level of [8, 9, 10] as const) {
      const { container, unmount } = render(<LevelChip level={level} />);
      expect(container.firstElementChild).toHaveClass("text-ink");
      unmount();
    }
  });
});

describe("LevelChip — committed dimensions", () => {
  it("is a 28px square", () => {
    // `.lv` is 28px — `h-7`/`w-7` in Tailwind's 4px scale.
    expect(chipFor(3)).toHaveClass("h-7", "w-7");
  });
});

describe("LevelChip — content", () => {
  it("shows the level number", () => {
    render(<LevelChip level={4} />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("names itself for assistive tech", () => {
    render(<LevelChip level={4} />);
    expect(screen.getByText("Nivel 4")).toBeInTheDocument();
  });

  it("accepts a custom label", () => {
    render(<LevelChip level={2} label="Nivel 2 · Competitivo" />);
    expect(screen.getByText("Nivel 2 · Competitivo")).toBeInTheDocument();
  });

  it("shows rank and nothing else — no occupancy, no fraction, no meter", () => {
    const chip = chipFor(6);
    expect(chip.textContent).toBe("Nivel 66");
    expect(chip.textContent).not.toMatch(/\//);
    expect(chip.querySelector("progress, meter")).toBeNull();
  });
});

describe("isLevel", () => {
  it("accepts 1 through 10", () => {
    for (const level of LEVELS) expect(isLevel(level)).toBe(true);
  });

  it("rejects anything off the ladder", () => {
    for (const value of [0, 11, -1, 2.5, Number.NaN]) {
      expect(isLevel(value)).toBe(false);
    }
  });
});
