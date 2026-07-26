/**
 * The range rules behind the shared attendance filter panel.
 *
 * The one that matters is `null` vs `{}`: an incomplete custom range must NOT
 * degrade into "no filters", which would quietly show the whole table under
 * controls that say otherwise.
 */

import { describe, it, expect } from "vitest";
import {
  buildAttendanceQuery,
  customRangeError,
  DATE_PRESETS,
  isCustomRangeComplete,
  RANGE_ERROR,
} from "../attendance-filters-utils";

const BASE = { customStart: "", customEnd: "", horarioId: null, personaId: null } as const;

describe("isCustomRangeComplete", () => {
  it("needs both ends", () => {
    expect(isCustomRangeComplete("", "")).toBe(false);
    expect(isCustomRangeComplete("2026-07-01", "")).toBe(false);
    expect(isCustomRangeComplete("", "2026-07-01")).toBe(false);
  });

  it("accepts a single-day range but rejects an inverted one", () => {
    expect(isCustomRangeComplete("2026-07-01", "2026-07-01")).toBe(true);
    expect(isCustomRangeComplete("2026-07-01", "2026-07-20")).toBe(true);
    expect(isCustomRangeComplete("2026-07-20", "2026-07-01")).toBe(false);
  });
});

describe("customRangeError", () => {
  it("stays silent until both ends exist", () => {
    expect(customRangeError("", "")).toBeNull();
    expect(customRangeError("2026-07-20", "")).toBeNull();
  });

  it("names the problem for an inverted range", () => {
    expect(customRangeError("2026-07-20", "2026-07-01")).toBe(RANGE_ERROR);
    expect(customRangeError("2026-07-01", "2026-07-20")).toBeNull();
  });
});

describe("buildAttendanceQuery", () => {
  it("resolves a preset into a concrete range", () => {
    const query = buildAttendanceQuery({ ...BASE, preset: "today" });
    expect(query).not.toBeNull();
    expect(query?.fechaInicio).toBe(query?.fechaFin);
    expect(query?.fechaInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns null — never an empty query — while a custom range is unusable", () => {
    expect(buildAttendanceQuery({ ...BASE, preset: "custom" })).toBeNull();
    expect(
      buildAttendanceQuery({ ...BASE, preset: "custom", customStart: "2026-07-01" }),
    ).toBeNull();
    expect(
      buildAttendanceQuery({
        ...BASE,
        preset: "custom",
        customStart: "2026-07-20",
        customEnd: "2026-07-01",
      }),
    ).toBeNull();
  });

  it("uses the two pickers verbatim once the custom range is valid", () => {
    expect(
      buildAttendanceQuery({
        ...BASE,
        preset: "custom",
        customStart: "2026-07-01",
        customEnd: "2026-07-20",
      }),
    ).toEqual({ fechaInicio: "2026-07-01", fechaFin: "2026-07-20" });
  });

  it("omits horario and alumno rather than sending nulls", () => {
    const query = buildAttendanceQuery({ ...BASE, preset: "this_month" });
    expect(query).not.toHaveProperty("horarioId");
    expect(query).not.toHaveProperty("personaId");
  });

  it("carries horario and alumno when they are set", () => {
    expect(
      buildAttendanceQuery({ ...BASE, preset: "this_month", horarioId: 9, personaId: 42 }),
    ).toMatchObject({ horarioId: 9, personaId: 42 });
  });
});

describe("DATE_PRESETS", () => {
  it("offers the four ranges both attendance screens share, escape hatch last", () => {
    expect(DATE_PRESETS.map((p) => p.key)).toEqual(["today", "this_week", "this_month", "custom"]);
    expect(DATE_PRESETS.map((p) => p.label)).toEqual([
      "Hoy",
      "Esta semana",
      "Este mes",
      "Rango personalizado",
    ]);
  });
});
