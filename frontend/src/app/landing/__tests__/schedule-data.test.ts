/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { mapPublicSchedules, type PublicSchedulePayload } from "@/app/landing/schedule-data";

describe("mapPublicSchedules", (): void => {
  it("maps admin-created categories and uppercase Spanish days into landing slots", (): void => {
    const payload: PublicSchedulePayload[] = [
      {
        category: "Nocturno",
        blocks: [{ days: ["LUNES", "MIERCOLES", "VIERNES"], startTime: "19:00", endTime: "20:30" }],
      },
    ];

    expect(mapPublicSchedules(payload)).toEqual([
      {
        category: "Nocturno",
        slots: [{ hours: "19:00 – 20:30", days: "Lunes, Miércoles y Viernes", on: "week" }],
      },
    ]);
  });

  it("maps Saturday and Sunday without exposing unknown day values", (): void => {
    expect(mapPublicSchedules([
      { category: "Fin de semana", blocks: [{ days: ["SABADO", "DOMINGO"], startTime: "09:00", endTime: "10:00" }] },
    ])).toEqual([
      { category: "Fin de semana", slots: [{ hours: "09:00 – 10:00", days: "Sábado y Domingo", on: "sat" }] },
    ]);
  });

  /**
   * `ages` is the optional orientation label the public catalog gained in
   * #913 ("5 a 10 años", "Selección") — copy, never a rule: no age is
   * validated against it. It is the landing's `audience`, and it is the last
   * field that used to force the page to keep its own schedule list.
   */
  it("carries the published age label through as the category's audience", (): void => {
    expect(mapPublicSchedules([
      { category: "Formativo", ages: "5 a 10 años", blocks: [{ days: ["LUNES"], startTime: "15:00", endTime: "16:00" }] },
    ])).toEqual([
      {
        category: "Formativo",
        audience: "5 a 10 años",
        slots: [{ hours: "15:00 – 16:00", days: "Lunes", on: "week" }],
      },
    ]);
  });

  it("leaves the audience unset when the category publishes no age label", (): void => {
    const [absent] = mapPublicSchedules([
      { category: "Juego Libre", blocks: [{ days: ["SABADO"], startTime: "15:00", endTime: "18:00" }] },
    ]);
    const [explicitNull] = mapPublicSchedules([
      { category: "Juego Libre", ages: null, blocks: [{ days: ["SABADO"], startTime: "15:00", endTime: "18:00" }] },
    ]);

    // Absent and null mean the same thing: the club published no label, so
    // the landing shows no Edad fact rather than making one up.
    expect(absent.audience).toBeUndefined();
    expect(explicitNull.audience).toBeUndefined();
    expect(Object.hasOwn(absent, "audience")).toBe(false);
  });

  it("ignores an age label that is blank or not text at all", (): void => {
    const [blank] = mapPublicSchedules([
      { category: "Formativo", ages: "   ", blocks: [{ days: ["LUNES"], startTime: "15:00", endTime: "16:00" }] },
    ]);
    const [wrongType] = mapPublicSchedules([
      { category: "Infantil", ages: 12, blocks: [{ days: ["LUNES"], startTime: "16:00", endTime: "17:00" }] },
    ]);

    expect(blank.audience).toBeUndefined();
    expect(wrongType.audience).toBeUndefined();
    // The category itself still publishes: a bad label is not a reason to
    // hide a real training block.
    expect(wrongType.category).toBe("Infantil");
  });

  it("drops malformed records and returns an honest empty result", (): void => {
    expect(mapPublicSchedules([
      { category: "", blocks: [] },
      { category: "Roto", blocks: [{ days: ["UNKNOWN"], startTime: "x", endTime: "y" }] },
    ])).toEqual([]);
    expect(mapPublicSchedules(null)).toEqual([]);
  });
});
