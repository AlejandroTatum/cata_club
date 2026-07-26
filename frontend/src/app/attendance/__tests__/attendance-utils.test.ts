/**
 * Unit tests for the admin attendance utilities.
 *
 * Pure functions — no React dependencies, easy to test.
 */

import { describe, it, expect } from "vitest";
import {
  MOCK_ATTENDANCE_RECORDS,
  MOCK_SCHEDULES,
} from "@/mocks/attendance";
import {
  buildAttendanceStats,
  formatDay,
  formatNivel,
  getAttendanceBadgeTokens,
  getAttendanceRatePercent,
  paginateRecords,
  getTotalPages,
  ATTENDANCE_PAGE_SIZE,
  groupSchedulesByDay,
  formatHumanDate,
  selectVisibleSchedules,
  type AttendanceRecord,
  type TrainingSchedule,
} from "../attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";

// ---------------------------------------------------------------------------
// buildAttendanceStats
// ---------------------------------------------------------------------------

describe("buildAttendanceStats", () => {
  it("returns zero stats for an empty list", () => {
    const stats = buildAttendanceStats([]);
    expect(stats).toEqual({
      totalPresent: 0,
      totalAbsent: 0,
      totalLate: 0,
      totalJustified: 0,
      totalUnknown: 0,
      totalStudents: 0,
    });
  });

  it("counts attendance states from mock records", () => {
    const stats = buildAttendanceStats(MOCK_ATTENDANCE_RECORDS);
    expect(stats.totalStudents).toBe(6);
    expect(stats.totalPresent).toBe(3);
    expect(stats.totalAbsent).toBe(1);
    expect(stats.totalLate).toBe(1);
    expect(stats.totalJustified).toBe(1);
    expect(stats.totalUnknown).toBe(0);
  });

  it("counts correctly when all students have the same state", () => {
    const records: AttendanceRecord[] = [
      {
        id: "a1",
        fecha: "2026-07-01",
        horario: "Test",
        personaId: 1,
        estudiante: "Student A",
        estado: "present",
        entrenador: "Trainer X",
      },
      {
        id: "a2",
        fecha: "2026-07-01",
        horario: "Test",
        personaId: 2,
        estudiante: "Student B",
        estado: "present",
        entrenador: "Trainer X",
      },
    ];
    const stats = buildAttendanceStats(records);
    expect(stats.totalPresent).toBe(2);
    expect(stats.totalAbsent).toBe(0);
    expect(stats.totalStudents).toBe(2);
  });

  it("handles mixed states correctly", () => {
    const records: AttendanceRecord[] = [
      { id: "a1", fecha: "2026-07-01", horario: "T1", personaId: 1, estudiante: "S1", estado: "present", entrenador: "T" },
      { id: "a2", fecha: "2026-07-01", horario: "T1", personaId: 2, estudiante: "S2", estado: "absent", entrenador: "T" },
      { id: "a3", fecha: "2026-07-01", horario: "T1", personaId: 3, estudiante: "S3", estado: "late", entrenador: "T" },
      { id: "a4", fecha: "2026-07-01", horario: "T1", personaId: 4, estudiante: "S4", estado: "justified", entrenador: "T" },
    ];
    const stats = buildAttendanceStats(records);
    expect(stats.totalPresent).toBe(1);
    expect(stats.totalAbsent).toBe(1);
    expect(stats.totalLate).toBe(1);
    expect(stats.totalJustified).toBe(1);
    expect(stats.totalUnknown).toBe(0);
    expect(stats.totalStudents).toBe(4);
  });

  it("counts unknown estados separately — defensive against bad runtime data", () => {
    const records: AttendanceRecord[] = [
      { id: "u1", fecha: "2026-07-01", horario: "T1", personaId: 1, estudiante: "S1", estado: "present" as EstadoAsistencia, entrenador: "T" },
      { id: "u2", fecha: "2026-07-01", horario: "T1", personaId: 2, estudiante: "S2", estado: "unknown_value" as EstadoAsistencia, entrenador: "T" },
      { id: "u3", fecha: "2026-07-01", horario: "T1", personaId: 3, estudiante: "S3", estado: "" as EstadoAsistencia, entrenador: "T" },
    ];
    const stats = buildAttendanceStats(records);
    expect(stats.totalPresent).toBe(1);
    expect(stats.totalUnknown).toBe(2);
    expect(stats.totalStudents).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// formatDay
// ---------------------------------------------------------------------------

describe("formatDay", () => {
  it('returns "Lunes" for lun', () => {
    expect(formatDay("lun")).toBe("Lunes");
  });

  it('returns "Sábado" for sab', () => {
    expect(formatDay("sab")).toBe("Sábado");
  });

  it('returns "Domingo" for dom (backend covers the full civil week)', () => {
    expect(formatDay("dom")).toBe("Domingo");
  });

  it("returns a label for every known day", () => {
    const days = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
    for (const day of days) {
      expect(formatDay(day).length).toBeGreaterThan(0);
    }
  });

  it("returns fallback for unexpected day value at runtime", () => {
    // @ts-expect-error — testing runtime resilience with unexpected value
    const result = formatDay("domingo");
    expect(result).toContain("Día desconocido");
    expect(result).toContain("domingo");
  });

  it("never returns undefined", () => {
    // @ts-expect-error — testing runtime resilience with unexpected value
    expect(formatDay(undefined)).toBe("Día desconocido: undefined");
  });
});

// ---------------------------------------------------------------------------
// formatNivel
// ---------------------------------------------------------------------------

describe("formatNivel", () => {
  it('returns "Principiante" for principiante', () => {
    expect(formatNivel("principiante")).toBe("Principiante");
  });

  it('returns "Intermedio" for intermedio', () => {
    expect(formatNivel("intermedio")).toBe("Intermedio");
  });

  it('returns "Avanzado" for avanzado', () => {
    expect(formatNivel("avanzado")).toBe("Avanzado");
  });

  it("returns fallback for unexpected nivel value at runtime", () => {
    // @ts-expect-error — testing runtime resilience with unexpected value
    const result = formatNivel("profesional");
    expect(result).toContain("Nivel desconocido");
    expect(result).toContain("profesional");
  });

  it("never returns undefined for unknown nivel", () => {
    // @ts-expect-error — testing runtime resilience with unexpected value
    expect(formatNivel(undefined)).toBe("Nivel desconocido: undefined");
  });
});

// ---------------------------------------------------------------------------
// Mock data integrity
// ---------------------------------------------------------------------------

describe("MOCK_SCHEDULES", () => {
  it("has at least one schedule", () => {
    expect(MOCK_SCHEDULES.length).toBeGreaterThan(0);
  });

  it("every schedule has required fields", () => {
    for (const s of MOCK_SCHEDULES) {
      expect(s.id).toBeTruthy();
      expect(s.diaSemana).toBeTruthy();
      expect(s.horaInicio).toBeTruthy();
      expect(s.horaFin).toBeTruthy();
      expect(s.cancha).toBeTruthy();
      expect(s.cupoMaximo).toBeGreaterThan(0);
    }
  });
});

describe("MOCK_ATTENDANCE_RECORDS", () => {
  it("has at least one record", () => {
    expect(MOCK_ATTENDANCE_RECORDS.length).toBeGreaterThan(0);
  });

  it("every record has required fields", () => {
    for (const r of MOCK_ATTENDANCE_RECORDS) {
      expect(r.id).toBeTruthy();
      expect(r.fecha).toBeTruthy();
      expect(r.horario).toBeTruthy();
      expect(r.estudiante).toBeTruthy();
      expect(r.entrenador).toBeTruthy();
      expect(["present", "absent", "late", "justified"] as const).toContain(r.estado);
    }
  });

  it("includes records from different trainers (not trainer-owned)", () => {
    const trainers = new Set(MOCK_ATTENDANCE_RECORDS.map((r) => r.entrenador));
    expect(trainers.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// getAttendanceBadgeTokens (Fase 3b — B4 light-theme badge tokens)
// ---------------------------------------------------------------------------

describe("getAttendanceBadgeTokens", () => {
  it("returns state-ok light tokens for present", () => {
    expect(getAttendanceBadgeTokens("present")).toEqual({
      badgeClass: "bg-cata-state-ok/10 text-cata-state-ok",
      iconClass: "text-cata-state-ok",
    });
  });

  it("returns red-50/red-700 light tokens for absent", () => {
    expect(getAttendanceBadgeTokens("absent")).toEqual({
      badgeClass: "bg-red-50 text-red-700",
      iconClass: "text-red-700",
    });
  });

  it("returns amber-50/amber-700 light tokens for late", () => {
    expect(getAttendanceBadgeTokens("late")).toEqual({
      badgeClass: "bg-amber-50 text-amber-700",
      iconClass: "text-amber-700",
    });
  });

  it("returns blue-50/blue-700 light tokens for justified", () => {
    expect(getAttendanceBadgeTokens("justified")).toEqual({
      badgeClass: "bg-blue-50 text-blue-700",
      iconClass: "text-blue-700",
    });
  });

  it("returns a neutral fallback for unknown estado values — never throws", () => {
    expect(getAttendanceBadgeTokens("unexpected_value")).toEqual({
      badgeClass: "bg-cata-border/40 text-cata-text/65",
      iconClass: "text-cata-text/65",
    });
  });

  it("never returns a dark-theme (rgba/900 or bare white) token — regression guard for B4", () => {
    for (const estado of ["present", "absent", "late", "justified", "unknown_value"]) {
      const tokens = getAttendanceBadgeTokens(estado);
      expect(tokens.badgeClass).not.toMatch(/900|text-white|bg-white/);
      expect(tokens.iconClass).not.toMatch(/900|text-white|bg-white/);
    }
  });
});

// ---------------------------------------------------------------------------
// getAttendanceRatePercent
// ---------------------------------------------------------------------------

describe("getAttendanceRatePercent", () => {
  it("returns 0 for zero records instead of NaN", () => {
    const stats = buildAttendanceStats([]);
    expect(getAttendanceRatePercent(stats)).toBe(0);
  });

  it("computes the rounded present-rate percentage", () => {
    const stats = {
      totalPresent: 89,
      totalAbsent: 11,
      totalLate: 0,
      totalJustified: 0,
      totalUnknown: 0,
      totalStudents: 100,
    };
    expect(getAttendanceRatePercent(stats)).toBe(89);
  });

  it("rounds to the nearest whole percent", () => {
    const stats = {
      totalPresent: 2,
      totalAbsent: 1,
      totalLate: 0,
      totalJustified: 0,
      totalUnknown: 0,
      totalStudents: 3,
    };
    // 2/3 = 66.66...% → rounds to 67
    expect(getAttendanceRatePercent(stats)).toBe(67);
  });
});

// ---------------------------------------------------------------------------
// paginateRecords / getTotalPages (PR3 — client-side attendance pagination)
// ---------------------------------------------------------------------------

function buildRecords(count: number): AttendanceRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `rec-${i}`,
    fecha: "2026-07-01",
    horario: "Test",
    personaId: i,
    estudiante: `Student ${i}`,
    estado: "present" as EstadoAsistencia,
    entrenador: "Trainer X",
  }));
}

describe("paginateRecords", () => {
  it("slices records to ATTENDANCE_PAGE_SIZE for page 1, and the remainder for a later page", () => {
    expect(ATTENDANCE_PAGE_SIZE).toBe(10);
    const records = buildRecords(25);
    const page1 = paginateRecords(records, 1);
    expect(page1).toHaveLength(10);
    expect(page1[0].id).toBe("rec-0");
    expect(page1[9].id).toBe("rec-9");
    const page3 = paginateRecords(records, 3);
    expect(page3).toHaveLength(5);
    expect(page3[0].id).toBe("rec-20");
  });

  it("returns an empty array for a page beyond the data", () => {
    expect(paginateRecords(buildRecords(10), 5)).toEqual([]);
  });

  it("reflects a filtered subset, not the unfiltered total", () => {
    const records = buildRecords(288);
    const filtered = records.filter((r) => r.id === "rec-0" || r.id === "rec-1");
    expect(paginateRecords(filtered, 1)).toEqual(filtered);
    expect(getTotalPages(filtered.length)).toBe(1);
  });
});

describe("getTotalPages", () => {
  it("rounds up to a whole page count, floored at 1 (never 0 pages)", () => {
    expect(getTotalPages(288)).toBe(29);
    expect(getTotalPages(11)).toBe(2);
    expect(getTotalPages(10)).toBe(1);
    expect(getTotalPages(0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// groupSchedulesByDay (PR3 — Horarios de Entrenamiento density)
// ---------------------------------------------------------------------------

function buildSchedule(id: number, diaSemana: TrainingSchedule["diaSemana"]): TrainingSchedule {
  return {
    id,
    diaSemana,
    horaInicio: "15:00",
    horaFin: "16:00",
    entrenadorId: 1,
    entrenadorNombre: `Entrenador ${id}`,
    nivelRankingId: null,
  };
}

describe("groupSchedulesByDay", () => {
  it("groups schedules under their diaSemana, ordered Lunes..Domingo regardless of input order, with day labels", () => {
    const schedules = [
      buildSchedule(1, "vie"),
      buildSchedule(2, "lun"),
      buildSchedule(3, "lun"),
      buildSchedule(4, "dom"),
    ];
    const groups = groupSchedulesByDay(schedules);
    expect(groups.map((g) => g.day)).toEqual(["lun", "vie", "dom"]);
    expect(groups[0].schedules).toHaveLength(2);
    expect(groups[0].label).toBe("Lunes");
  });

  it("omits days with no schedules and loses none across the full week (25 horarios)", () => {
    const days: TrainingSchedule["diaSemana"][] = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"];
    const schedules = Array.from({ length: 25 }, (_, i) => buildSchedule(i, days[i % days.length]));
    const groups = groupSchedulesByDay(schedules);
    expect(groups).toHaveLength(7);
    expect(groups.reduce((sum, g) => sum + g.schedules.length, 0)).toBe(25);
  });

  it("returns an empty array for no schedules", () => {
    expect(groupSchedulesByDay([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatHumanDate — the "Hoy, 23 jul" grammar (Fase 3)
// ---------------------------------------------------------------------------

describe("formatHumanDate", () => {
  const today = new Date(2026, 6, 23, 9, 30); // 23 jul 2026, local

  it("names today and yesterday instead of making the reader compute them", () => {
    expect(formatHumanDate("2026-07-23", today)).toBe("Hoy, 23 jul");
    expect(formatHumanDate("2026-07-22", today)).toBe("Ayer, 22 jul");
  });

  it("drops the year while it is the current one", () => {
    expect(formatHumanDate("2026-01-05", today)).toBe("5 ene");
  });

  it("keeps the year once it stops being the current one", () => {
    expect(formatHumanDate("2025-12-20", today)).toBe("20 dic 2025");
  });

  it("reads a date-only value as a local calendar date, not UTC midnight", () => {
    // `new Date("2026-07-23")` is UTC midnight → 22 jul 19:00 in UTC-5, which
    // would render today's attendance as "Ayer".
    expect(formatHumanDate("2026-07-23", today)).toBe("Hoy, 23 jul");
  });

  it("accepts a full ISO timestamp as well as a date-only value", () => {
    expect(formatHumanDate(new Date(2026, 6, 23, 18, 42).toISOString(), today)).toBe("Hoy, 23 jul");
  });

  it("returns an empty string for unparseable or empty input", () => {
    expect(formatHumanDate("", today)).toBe("");
    expect(formatHumanDate("no es una fecha", today)).toBe("");
    expect(formatHumanDate("2026-13-45", today)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// selectVisibleSchedules — today by default, the full week on request
// ---------------------------------------------------------------------------

describe("selectVisibleSchedules", () => {
  const week = [
    buildSchedule(1, "lun"),
    buildSchedule(2, "mie"),
    buildSchedule(3, "mie"),
    buildSchedule(4, "vie"),
  ];

  it("narrows to today by default", () => {
    const result = selectVisibleSchedules(week, "mie", false);
    expect(result.schedules.map((s) => s.id)).toEqual([2, 3]);
    expect(result.narrowedToToday).toBe(true);
    expect(result.emptyToday).toBe(false);
  });

  it("shows the whole week once the user asks for it", () => {
    const result = selectVisibleSchedules(week, "mie", true);
    expect(result.schedules).toHaveLength(4);
    expect(result.narrowedToToday).toBe(false);
    expect(result.emptyToday).toBe(false);
  });

  it("falls back to the full week when today has nothing scheduled", () => {
    // Narrowing to an empty list would show a trainer a blank picker on a
    // rest day and leave them to guess that a filter caused it.
    const result = selectVisibleSchedules(week, "mar", false);
    expect(result.schedules).toHaveLength(4);
    expect(result.narrowedToToday).toBe(false);
    expect(result.emptyToday).toBe(true);
  });

  it("does not claim an empty today when there are no schedules at all", () => {
    // Nothing loaded is a different message from "nothing today" — the UI
    // must not blame the day filter for an empty backend response.
    const result = selectVisibleSchedules([], "mar", false);
    expect(result.schedules).toEqual([]);
    expect(result.emptyToday).toBe(false);
    expect(result.narrowedToToday).toBe(false);
  });

  it("never mutates the input list", () => {
    const input = [...week];
    selectVisibleSchedules(input, "mie", false);
    expect(input.map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });
});
