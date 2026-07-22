/**
 * Unit tests for Trainer Attendance utilities.
 *
 * Pure functions — no React dependencies, easy to test.
 */

import { describe, it, expect } from "vitest";
import {
  nextAttendanceState,
  countByState,
  buildAttendanceSummary,
  buildRosterFromTabla,
  resolveEntrenadorId,
  resolveDisplayTrainerName,
  deriveNivelIdFromSchedule,
  type SessionStudent,
} from "../attendance-utils";
import type { TablaRankingItem } from "@/services/api";

describe("nextAttendanceState", () => {
  it("cycles absent → present", () => {
    expect(nextAttendanceState("absent")).toBe("present");
  });

  it("cycles present → late", () => {
    expect(nextAttendanceState("present")).toBe("late");
  });

  it("cycles late → justified", () => {
    expect(nextAttendanceState("late")).toBe("justified");
  });

  it("cycles justified → absent (wraps around)", () => {
    expect(nextAttendanceState("justified")).toBe("absent");
  });

  it("handles unknown state by returning absent", () => {
    // @ts-expect-error — testing runtime resilience with unexpected value
    expect(nextAttendanceState("unknown")).toBe("absent");
  });
});

describe("countByState", () => {
  const students: SessionStudent[] = [
    { id: "a", name: "A", attendance: "present" },
    { id: "b", name: "B", attendance: "present" },
    { id: "c", name: "C", attendance: "absent" },
    { id: "d", name: "D", attendance: "late" },
    { id: "e", name: "E", attendance: "justified" },
    { id: "f", name: "F", attendance: "present" },
  ];

  it("counts present correctly", () => {
    expect(countByState(students, "present")).toBe(3);
  });

  it("counts absent correctly", () => {
    expect(countByState(students, "absent")).toBe(1);
  });

  it("counts late correctly", () => {
    expect(countByState(students, "late")).toBe(1);
  });

  it("counts justified correctly", () => {
    expect(countByState(students, "justified")).toBe(1);
  });

  it("returns 0 when no student has the given state", () => {
    expect(countByState(students, "justified")).toBe(1);
    const empty: SessionStudent[] = [];
    expect(countByState(empty, "present")).toBe(0);
  });
});

describe("buildAttendanceSummary", () => {
  it("builds summary for mixed states", () => {
    const students: SessionStudent[] = [
      { id: "a", name: "A", attendance: "present" },
      { id: "b", name: "B", attendance: "present" },
      { id: "c", name: "C", attendance: "absent" },
      { id: "d", name: "D", attendance: "late" },
    ];
    const summary = buildAttendanceSummary(students);
    expect(summary).toContain("2 presente");
    expect(summary).toContain("1 ausente");
    expect(summary).toContain("1 tardanza");
    expect(summary).toContain("0 justificado");
  });

  it("handles empty roster", () => {
    expect(buildAttendanceSummary([])).toBe("0 presente • 0 ausente • 0 tardanza • 0 justificado");
  });

  it("handles all present", () => {
    const students: SessionStudent[] = [
      { id: "a", name: "A", attendance: "present" },
      { id: "b", name: "B", attendance: "present" },
    ];
    const summary = buildAttendanceSummary(students);
    expect(summary).toContain("2 presente");
    expect(summary).toContain("0 ausente");
  });
});

describe("buildRosterFromTabla", () => {
  const tabla: TablaRankingItem[] = [
    { personaId: 3, personaNombreCompleto: "Sofia Alumna", posicionActual: null, puntajeAcumulado: 0, estaEnRanking: true },
    { personaId: 7, personaNombreCompleto: "Mateo Rodríguez", posicionActual: 2, puntajeAcumulado: 40, estaEnRanking: true },
  ];

  it("maps each roster row to a SessionStudent defaulted to absent", () => {
    const roster = buildRosterFromTabla(tabla);
    expect(roster).toEqual([
      { id: "3", name: "Sofia Alumna", attendance: "absent" },
      { id: "7", name: "Mateo Rodríguez", attendance: "absent" },
    ]);
  });

  it("returns an empty roster for an empty tabla", () => {
    expect(buildRosterFromTabla([])).toEqual([]);
  });

  it("stringifies personaId for use as a stable React key / POST payload id", () => {
    const roster = buildRosterFromTabla(tabla);
    expect(roster.every((s) => typeof s.id === "string")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveEntrenadorId / resolveDisplayTrainerName (PR8 — admin can take
// attendance on a trainer's behalf; backend requires entrenador_id to belong
// to an actual ENTRENADOR, so an admin's own id is never valid).
// ---------------------------------------------------------------------------

const SCHEDULE = { entrenadorId: 42, entrenadorNombre: "Coach Martinez" };

describe("resolveEntrenadorId", () => {
  it("uses the trainer's own session id when the current user is a trainer", () => {
    expect(resolveEntrenadorId("trainer", "17", SCHEDULE)).toBe(17);
  });

  it("uses the selected schedule's titular trainer id when the current user is an admin", () => {
    expect(resolveEntrenadorId("admin", "99", SCHEDULE)).toBe(42);
  });

  it("returns null for an admin when no schedule is selected yet", () => {
    expect(resolveEntrenadorId("admin", "99", null)).toBeNull();
  });

  it("returns null for a trainer with no session id", () => {
    expect(resolveEntrenadorId("trainer", null, SCHEDULE)).toBeNull();
  });
});

describe("resolveDisplayTrainerName", () => {
  it("shows the trainer's own session name when the current user is a trainer", () => {
    expect(resolveDisplayTrainerName("trainer", "Coach Torres", SCHEDULE)).toBe("Coach Torres");
  });

  it("shows the selected schedule's titular trainer name when the current user is an admin", () => {
    expect(resolveDisplayTrainerName("admin", "Admin User", SCHEDULE)).toBe("Coach Martinez");
  });

  it("falls back to a generic label for an admin when no schedule is selected yet", () => {
    expect(resolveDisplayTrainerName("admin", "Admin User", null)).toBe("Entrenador");
  });
});

// ---------------------------------------------------------------------------
// deriveNivelIdFromSchedule (Slice 7 — schedule→group linkage)
// ---------------------------------------------------------------------------

describe("deriveNivelIdFromSchedule", () => {
  it("derives the linked nivel id when the schedule has nivelRankingId set", () => {
    expect(deriveNivelIdFromSchedule({ nivelRankingId: 5 })).toBe(5);
  });

  it("returns null (manual-fallback path preserved) when nivelRankingId is null", () => {
    expect(deriveNivelIdFromSchedule({ nivelRankingId: null })).toBeNull();
  });

  it("returns null when nivelRankingId is absent (optional/additive field)", () => {
    expect(deriveNivelIdFromSchedule({})).toBeNull();
  });

  it("returns null when no schedule is selected yet", () => {
    expect(deriveNivelIdFromSchedule(null)).toBeNull();
  });

  it("never fabricates or invents a nivel id — only reads the field the response exposes", () => {
    // Negative assertion: passing an object with unrelated/extra fields must
    // not cause the function to derive anything beyond nivelRankingId itself.
    const scheduleLike = { id: 12, entrenadorId: 3, nivelRankingId: 7 };
    expect(deriveNivelIdFromSchedule(scheduleLike)).toBe(7);
    expect(deriveNivelIdFromSchedule({ ...scheduleLike, nivelRankingId: null })).toBeNull();
  });
});
