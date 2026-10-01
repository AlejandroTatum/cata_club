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
  buildScheduleSlots,
  narrowSchedules,
  narrowToHorarios,
  resolveScheduleFilter,
  slotDayOptions,
  toApiParams,
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

const SCHEDULES = [
  { id: 1, diaSemana: "vie", horaInicio: "17:00", horaFin: "18:00", categoriaLabel: "Competitivo" },
  { id: 2, diaSemana: "lun", horaInicio: "17:00", horaFin: "18:00", categoriaLabel: "Competitivo" },
  { id: 3, diaSemana: "lun", horaInicio: "17:00", horaFin: "18:00", categoriaLabel: "Recreativo" },
  { id: 4, diaSemana: "mar", horaInicio: "09:00", horaFin: "10:00" },
] as const;

describe("buildScheduleSlots", () => {
  const slots = buildScheduleSlots(SCHEDULES);

  it("dedupes days into one slot per category and time range", () => {
    expect(slots.map((s) => s.label)).toEqual([
      "Competitivo · 17:00–18:00",
      "Recreativo · 17:00–18:00",
      "Sin categoría · 09:00–10:00",
    ]);
  });

  it("lists a slot's days Monday first", () => {
    expect(slotDayOptions(slots[0])).toEqual([
      { id: 2, label: "Lunes" },
      { id: 1, label: "Viernes" },
    ]);
    expect(slotDayOptions(undefined)).toEqual([]);
  });
});

describe("resolveScheduleFilter", () => {
  const slots = buildScheduleSlots(SCHEDULES);
  const key = slots[0]?.key ?? "";

  it("selects nothing without a slot or for a stale slot", () => {
    expect(resolveScheduleFilter(slots, null, null)).toEqual({});
    expect(resolveScheduleFilter(slots, "gone|00:00|01:00", 1)).toEqual({});
  });

  it("maps a chosen day to its single horarioId", () => {
    expect(resolveScheduleFilter(slots, key, 1)).toEqual({ horarioId: 1 });
  });

  it("maps 'Todos los días' to every id of the slot", () => {
    expect(resolveScheduleFilter(slots, key, null)).toEqual({ horarioIds: [2, 1] });
  });

  it("ignores a day that is not part of the slot", () => {
    expect(resolveScheduleFilter(slots, key, 3)).toEqual({ horarioIds: [2, 1] });
  });
});

describe("slot filtering stays correct without API support", () => {
  const query = buildAttendanceQuery({ ...BASE, preset: "today", horarioIds: [1, 2] });

  it("keeps horarioIds in the query but off the wire", () => {
    expect(query?.horarioIds).toEqual([1, 2]);
    expect(toApiParams(query ?? {})).not.toHaveProperty("horarioIds");
    expect(toApiParams(query ?? {})).not.toHaveProperty("horarioId");
  });

  it("a single day wins over the id set", () => {
    const q = buildAttendanceQuery({ ...BASE, preset: "today", horarioId: 5, horarioIds: [1, 2] });
    expect(q?.horarioId).toBe(5);
    expect(q?.horarioIds).toBeUndefined();
  });

  it("narrows records and schedules to the slot's horarios", () => {
    const rows = [{ horarioId: 1 }, { horarioId: 3 }, { horarioId: 2 }];
    expect(narrowToHorarios(rows, query)).toEqual([{ horarioId: 1 }, { horarioId: 2 }]);
    expect(narrowToHorarios(rows, { fechaInicio: "x" })).toEqual(rows);
    expect(narrowSchedules(SCHEDULES, query).map((s) => s.id)).toEqual([1, 2]);
  });
});
