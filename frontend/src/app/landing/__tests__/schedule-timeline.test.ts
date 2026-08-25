import { describe, expect, it } from "vitest";
import { landingConfig, type LandingSchedule } from "@/app/landing/landing-config";
import {
  barGeometry,
  closedWeekdayGap,
  deriveDayRange,
  formatClock,
  parseClockRange,
} from "@/app/landing/schedule-timeline";

describe("parseClockRange", (): void => {
  it("parses a zero-padded HH:MM – HH:MM block into minutes", (): void => {
    expect(parseClockRange("08:00 – 09:15")).toEqual({ start: 480, end: 555 });
    expect(parseClockRange("15:00 – 16:00")).toEqual({ start: 900, end: 960 });
    expect(parseClockRange("20:00 – 21:15")).toEqual({ start: 1200, end: 1275 });
  });

  it("still parses a single-digit hour the published format never uses", (): void => {
    expect(parseClockRange("8:00 – 9:15")).toEqual({ start: 480, end: 555 });
  });
});

describe("formatClock", (): void => {
  it("zero-pads hours and minutes", (): void => {
    expect(formatClock(480)).toBe("08:00");
    expect(formatClock(555)).toBe("09:15");
    expect(formatClock(0)).toBe("00:00");
  });

  it("keeps two-digit hours unpadded", (): void => {
    expect(formatClock(1275)).toBe("21:15");
    expect(formatClock(1320)).toBe("22:00");
  });
});

describe("deriveDayRange", (): void => {
  it("spans the earliest start and latest end across every slot, not just the first of each category", (): void => {
    expect(deriveDayRange(landingConfig.schedules)).toEqual({ start: 480, end: 1275, span: 795 });
  });

  it("derives the same opening from a single multi-slot category", (): void => {
    const onlyAdultos = landingConfig.schedules.filter((schedule): boolean => schedule.category === "Adultos");
    expect(deriveDayRange(onlyAdultos)).toEqual({ start: 480, end: 1275, span: 795 });
  });

  it("derives a Saturday-only day range", (): void => {
    const onlyJuegoLibre = landingConfig.schedules.filter((schedule): boolean => schedule.category === "Juego Libre");
    expect(deriveDayRange(onlyJuegoLibre)).toEqual({ start: 900, end: 1080, span: 180 });
  });

  it("returns a zero range instead of infinities for an empty schedule set", (): void => {
    expect(deriveDayRange([])).toEqual({ start: 0, end: 0, span: 0 });
  });
});

describe("barGeometry", (): void => {
  const range = deriveDayRange(landingConfig.schedules);

  it("places the Adultos morning block at the very start of the shared scale", (): void => {
    expect(barGeometry("08:00 – 09:15", range).left).toBeCloseTo(0, 5);
    expect(barGeometry("08:00 – 09:15", range).width).toBeCloseTo((75 / 795) * 100, 5);
  });

  it("places the Adultos evening block at the far end of the scale", (): void => {
    const geometry = barGeometry("20:00 – 21:15", range);
    expect(geometry.left).toBeCloseTo((1200 - 480) / 795 * 100, 5);
    expect(geometry.width).toBeCloseTo((75 / 795) * 100, 5);
  });

  it("places a Saturday band on the same scale as the weekday it replaces", (): void => {
    const geometry = barGeometry("15:00 – 18:00", range);
    expect(geometry.left).toBeCloseTo((900 - 480) / 795 * 100, 5);
    expect(geometry.width).toBeCloseTo((180 / 795) * 100, 5);
  });
});

describe("data-driven day groups", (): void => {
  it("keeps every published slot inside the shared scale derived from the same data", (): void => {
    const range = deriveDayRange(landingConfig.schedules);
    landingConfig.schedules.forEach((schedule): void => {
      schedule.slots.forEach((slot): void => {
        const geometry = barGeometry(slot.hours, range);
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.width).toBeGreaterThan(0);
        // Floating-point drift may push the right edge to 100.00000000000001.
        expect(geometry.left + geometry.width).toBeLessThanOrEqual(100 + 1e-9);
      });
    });
  });
});

describe("closedWeekdayGap", (): void => {
  it("finds the midday closure between the morning and afternoon weekday blocks", (): void => {
    expect(closedWeekdayGap(landingConfig.schedules)).toEqual({ start: 555, end: 900 });
  });

  it("ignores Saturday-only slots when measuring the weekday gap", (): void => {
    const schedules = landingConfig.schedules.filter((schedule): boolean => schedule.slots.some((slot): boolean => slot.on === "week"));
    expect(closedWeekdayGap(schedules)).toEqual({ start: 555, end: 900 });
  });

  it("returns null when no weekday gap exceeds sixty minutes", (): void => {
    const backToBack: LandingSchedule[] = [
      { category: "A", audience: "x", slots: [{ hours: "09:00 – 10:00", days: "Lunes a Viernes", on: "week" }] },
      { category: "B", audience: "x", slots: [{ hours: "10:30 – 11:30", days: "Lunes a Viernes", on: "week" }] },
    ];
    expect(closedWeekdayGap(backToBack)).toBeNull();
  });

  it("returns null when there are no weekday slots at all", (): void => {
    const saturdayOnly: LandingSchedule[] = [
      { category: "A", audience: "x", slots: [{ hours: "15:00 – 18:00", days: "Sábado", on: "sat" }] },
    ];
    expect(closedWeekdayGap(saturdayOnly)).toBeNull();
  });
});
