import { describe, it, expect } from "vitest";
import { ICON, ICON_STEPS } from "../icon-size";

describe("icon scale", () => {
  it("offers exactly three steps", () => {
    expect(Object.keys(ICON)).toEqual(["sm", "base", "lg"]);
    expect(ICON_STEPS).toHaveLength(3);
  });

  it("derives every step from a type step at the same ratio", () => {
    // The scale is `text-xs`, `text-base` and `text-lg` multiplied by 1.2 —
    // one ratio, three type steps, three whole pixels. Nothing is rounded,
    // which is what keeps the icon scale a transform of the type scale rather
    // than a second catalogue drifting beside it.
    const TYPE = { xs: 12.5, base: 15, lg: 20 };
    const RATIO = 1.2;

    expect(ICON.sm).toBe(TYPE.xs * RATIO);
    expect(ICON.base).toBe(TYPE.base * RATIO);
    expect(ICON.lg).toBe(TYPE.lg * RATIO);
    expect(Object.values(ICON).every(Number.isInteger)).toBe(true);
  });

  it("keeps the steps ordered and free of near-duplicates", () => {
    const values = ICON_STEPS.map((step) => step.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    // The inventory this scale replaces held fourteen sizes, ten of them
    // between 10 and 21. Three pixels is the smallest gap that stays visible.
    values.slice(1).forEach((value, index) => {
      expect(value - values[index]).toBeGreaterThanOrEqual(3);
    });
  });

  it("names each step the way the lock spells it back", () => {
    expect(ICON_STEPS.map((step) => step.token)).toEqual(["ICON.sm", "ICON.base", "ICON.lg"]);
  });
});
