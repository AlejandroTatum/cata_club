import { describe, expect, it } from "vitest";
import { ageScale, compactDays, resolveAgeSpans } from "@/app/landing/schedule-ages";

describe("resolveAgeSpans", (): void => {
  it("reads closed ranges as written", (): void => {
    expect(resolveAgeSpans(["5 a 10 años", "8 a 12 años"])).toEqual([
      { min: 5, max: 10, openEnded: false },
      { min: 8, max: 12, openEnded: false },
    ]);
  });

  it("reads 'Mayores de N' as starting at N + 1 and stopping before the next open-ended category", (): void => {
    const spans = resolveAgeSpans(["Mayores de 12 años", "Mayores de 18 años"]);
    expect(spans[0]).toEqual({ min: 13, max: 17, openEnded: false });
    expect(spans[1]).toEqual({ min: 18, max: 18, openEnded: true });
  });

  it("lets a lone open-ended category run to the end of the scale", (): void => {
    expect(resolveAgeSpans(["Más de 12 años", "5 a 10 años"])[0]).toEqual({ min: 13, max: 18, openEnded: true });
  });

  it("gives no span to labels without ages, like a squad name or an absent label", (): void => {
    expect(resolveAgeSpans(["Selección", undefined, ""])).toEqual([null, null, null]);
  });
});

describe("ageScale", (): void => {
  it("covers from the youngest to the oldest age any category reaches, flagging the open end", (): void => {
    const spans = resolveAgeSpans(["5 a 10 años", "8 a 12 años", "Mayores de 12 años", "Mayores de 18 años", "Selección"]);
    expect(ageScale(spans)).toEqual({ from: 5, to: 18, plus: true });
  });

  it("is absent when no category publishes a numeric age", (): void => {
    expect(ageScale(resolveAgeSpans(["Selección", undefined]))).toBeNull();
  });

  it("does not flag an open end when every range is closed", (): void => {
    expect(ageScale(resolveAgeSpans(["6 a 9 años"]))).toEqual({ from: 6, to: 9, plus: false });
  });
});

describe("compactDays", (): void => {
  it("collapses a run of three or more consecutive days", (): void => {
    expect(compactDays("Lunes, Martes, Miércoles, Jueves y Viernes")).toBe("Lunes a viernes");
    expect(compactDays("Lunes, Martes, Miércoles, Jueves, Viernes y Sábado")).toBe("Lunes a sábado");
  });

  it("keeps scattered or short day lists as written", (): void => {
    expect(compactDays("Lunes, Miércoles y Viernes")).toBe("Lunes, Miércoles y Viernes");
    expect(compactDays("Sábado")).toBe("Sábado");
  });
});
