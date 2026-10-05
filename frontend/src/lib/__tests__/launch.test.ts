import { describe, expect, it } from "vitest";
import { LAUNCH_AT, LAUNCH_AT_ISO, countdownParts, countdownSpeech, padUnit, resolveLaunchAt } from "../launch";

describe("launch constant", () => {
  it("is 17:00 Guayaquil on 2026-10-05", () => {
    expect(new Date(LAUNCH_AT_ISO).toISOString()).toBe("2026-10-05T22:00:00.000Z");
    expect(LAUNCH_AT).toBe(Date.parse(LAUNCH_AT_ISO));
    expect(resolveLaunchAt(undefined)).toBe(LAUNCH_AT);
  });

  it("accepts a valid override and ignores garbage", () => {
    expect(resolveLaunchAt("2026-01-01T00:00:00Z")).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(resolveLaunchAt("nope")).toBe(Date.parse(LAUNCH_AT_ISO));
  });
});

describe("countdownParts", () => {
  it("splits days, hours, minutes and seconds", () => {
    expect(countdownParts(((1 * 24 + 2) * 3600 + 3 * 60 + 4) * 1000)).toEqual({ days: 1, hours: 2, minutes: 3, seconds: 4 });
  });

  it("rolls over exactly at the day and hour boundaries", () => {
    expect(countdownParts(86_400_000)).toEqual({ days: 1, hours: 0, minutes: 0, seconds: 0 });
    expect(countdownParts(86_399_000)).toEqual({ days: 0, hours: 23, minutes: 59, seconds: 59 });
    expect(countdownParts(3_600_000)).toEqual({ days: 0, hours: 1, minutes: 0, seconds: 0 });
    expect(countdownParts(3_599_000)).toEqual({ days: 0, hours: 0, minutes: 59, seconds: 59 });
  });

  it("rounds a partial second up and never goes negative", () => {
    expect(countdownParts(1)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 1 });
    expect(countdownParts(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });
});

describe("formatting", () => {
  it("pads to two digits", () => {
    expect(padUnit(0)).toBe("00");
    expect(padUnit(7)).toBe("07");
    expect(padUnit(42)).toBe("42");
  });

  it("speaks only the relevant units in Spanish", () => {
    expect(countdownSpeech({ days: 1, hours: 1, minutes: 1, seconds: 9 })).toBe("1 día, 1 hora, 1 minuto");
    expect(countdownSpeech({ days: 0, hours: 2, minutes: 5, seconds: 0 })).toBe("2 horas, 5 minutos");
    expect(countdownSpeech({ days: 0, hours: 0, minutes: 0, seconds: 30 })).toBe("0 minutos, 30 segundos");
  });
});
