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

  it("drops malformed records and returns an honest empty result", (): void => {
    expect(mapPublicSchedules([
      { category: "", blocks: [] },
      { category: "Roto", blocks: [{ days: ["UNKNOWN"], startTime: "x", endTime: "y" }] },
    ])).toEqual([]);
    expect(mapPublicSchedules(null)).toEqual([]);
  });
});
