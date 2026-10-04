/**
 * The trainer dashboard's new pure helpers: weekly trend, student dots, roster
 * names, the previous-session summary and the hero's progress bar.
 */

import { describe, it, expect } from "vitest";
import type { AttendanceRecord, TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { AlumnoHorario } from "@/services/api";
import {
  buildHeroProgress,
  buildLastSessionSummary,
  buildRosterNamesByHorario,
  buildWeeklyAttendanceTrend,
  initialsOf,
  recentStatesOfStudent,
  trailingWeeksRange,
  type SessionCardLive,
  type SessionCardNext,
} from "../trainer-day-utils";

// Wednesday 2026-09-30, 12:00 in Guayaquil.
const NOW = new Date("2026-09-30T17:00:00Z");

function rec(estudiante: string, fecha: string, estado: AttendanceRecord["estado"], horarioId = 1): AttendanceRecord {
  return { id: `${estudiante}-${fecha}`, fecha, horario: "x", horarioId, personaId: 1, estudiante, estado };
}

describe("buildWeeklyAttendanceTrend", () => {
  it("rates quienes entrenaron — presentes MÁS tardanzas — per week, 0 for an empty week", () => {
    const trend = buildWeeklyAttendanceTrend(
      [rec("A", "2026-09-30", "present"), rec("B", "2026-09-30", "late"), rec("C", "2026-09-30", "absent"), rec("D", "2026-09-29", "sick")],
      NOW,
      6,
    );
    expect(trend).toHaveLength(6);
    expect(trend[5]).toMatchObject({ total: 4, attended: 2, ratePercent: 50 });
    expect(trend[0]).toMatchObject({ total: 0, ratePercent: 0 });
  });
});

describe("trailingWeeksRange", () => {
  it("spans exactly N weeks ending today", () => {
    expect(trailingWeeksRange(NOW, 6)).toEqual({ fechaInicio: "2026-08-20", fechaFin: "2026-09-30" });
  });
});

describe("recentStatesOfStudent", () => {
  it("returns the newest N of one student, oldest first", () => {
    const records = [rec("A", "2026-09-01", "present"), rec("A", "2026-09-08", "absent"), rec("A", "2026-09-15", "late"), rec("B", "2026-09-15", "absent")];
    expect(recentStatesOfStudent(records, "A", 2)).toEqual([
      { fecha: "2026-09-08", estado: "absent" },
      { fecha: "2026-09-15", estado: "late" },
    ]);
  });
});

describe("initialsOf", () => {
  it("takes up to two initials and never returns nothing", () => {
    expect(initialsOf("ana pérez gómez")).toBe("AP");
    expect(initialsOf("Sofia")).toBe("S");
    expect(initialsOf("   ")).toBe("?");
  });
});

describe("buildRosterNamesByHorario", () => {
  it("groups the names of today's horarios and ignores the rest", () => {
    const schedules = [{ id: 1 }, { id: 2 }] as TrainingSchedule[];
    const roster = [
      { horarioId: 1, personaNombreCompleto: "Ana" },
      { horarioId: 1, personaNombreCompleto: "Luis" },
      { horarioId: 9, personaNombreCompleto: "Otro" },
    ] as AlumnoHorario[];
    expect(buildRosterNamesByHorario(schedules, roster)).toEqual({ 1: ["Ana", "Luis"], 2: [] });
  });
});

describe("buildLastSessionSummary", () => {
  it("summarises the latest earlier date of that horario, counting presente and tardanza as attended", () => {
    const records = [
      rec("A", "2026-09-16", "present"),
      rec("A", "2026-09-23", "present"),
      rec("B", "2026-09-23", "late"),
      rec("C", "2026-09-23", "absent"),
      rec("D", "2026-09-23", "present", 2),
      rec("A", "2026-09-30", "present"),
    ];
    expect(buildLastSessionSummary(records, 1, "2026-09-30")).toEqual({ fecha: "2026-09-23", attended: 2, total: 3 });
  });

  it("is null when no earlier list exists for the horario", () => {
    expect(buildLastSessionSummary([rec("A", "2026-09-30", "present")], 1, "2026-09-30")).toBeNull();
    expect(buildLastSessionSummary([], 1, "2026-09-30")).toBeNull();
  });
});

describe("buildHeroProgress", () => {
  const schedule = { id: 1, diaSemana: "mie", horaInicio: "15:00", horaFin: "16:00" } as TrainingSchedule;
  const next = (minutesAway: number) => ({ kind: "next", schedule, minutesAway, href: "/x" }) as unknown as SessionCardNext;
  const live = (minutesElapsed: number) => ({ kind: "live", schedule, minutesElapsed, href: "/x" }) as unknown as SessionCardLive;

  it("fills over the last three hours before the start", () => {
    expect(buildHeroProgress(next(400))).toBe(0);
    expect(buildHeroProgress(next(90))).toBe(50);
    expect(buildHeroProgress(next(0))).toBe(100);
  });

  it("runs through the session once live, clamped to the range", () => {
    expect(buildHeroProgress(live(15))).toBe(25);
    expect(buildHeroProgress(live(600))).toBe(100);
  });
});
