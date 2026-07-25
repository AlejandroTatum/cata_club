/**
 * Unit tests for Trainer Attendance utilities.
 *
 * Pure functions — no React dependencies, easy to test.
 */

import { describe, it, expect } from "vitest";
import {
  UNMARKED,
  nextAttendanceState,
  countByState,
  countUnmarked,
  markUnmarkedAsPresent,
  toAttendanceMarks,
  buildAttendanceSummary,
  buildRosterFromAlumnoHorarios,
  resolveEntrenadorId,
  resolveDisplayTrainerName,
  type SessionStudent,
} from "../attendance-utils";
import type { AlumnoHorario } from "@/services/api";
import type { AttendanceRecord } from "@/app/attendance/attendance-utils";

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

describe("buildRosterFromAlumnoHorarios", () => {
  // camelCase fixture — matches the real backend contract: `AlumnoHorarioDetalleDTO`
  // inherits `ResponseBase`, so responses are serialized camelCase
  // (`persona_nombre_completo` never exists on the wire). A snake_case mock
  // here would silently hide the exact bug this test guards against.
  const alumnoHorarios: AlumnoHorario[] = [
    {
      id: 1,
      personaId: 3,
      personaNombreCompleto: "Sofia Alumna",
      edad: 11,
      horarioId: 12,
      horarioDia: "lun",
      horarioHoraInicio: "18:00",
      horarioHoraFin: "19:00",
      fechaAsignacion: "2026-01-01",
    },
    {
      id: 2,
      personaId: 7,
      personaNombreCompleto: "Mateo Rodríguez",
      edad: 13,
      horarioId: 12,
      horarioDia: "lun",
      horarioHoraInicio: "18:00",
      horarioHoraFin: "19:00",
      fechaAsignacion: "2026-01-01",
    },
  ];

  // Regression (silent data loss): the roster used to default every student
  // to "absent", so a trainer who tapped straight through the wizard filed
  // the whole session as a no-show without ever seeing those students. The
  // initial state must be the `unmarked` sentinel instead, which is never
  // submitted and which the wizard refuses to advance past.
  it("maps each alumno-horario row to a SessionStudent defaulted to unmarked", () => {
    const roster = buildRosterFromAlumnoHorarios(alumnoHorarios);
    expect(roster).toEqual([
      { id: "3", name: "Sofia Alumna", attendance: UNMARKED },
      { id: "7", name: "Mateo Rodríguez", attendance: UNMARKED },
    ]);
  });

  it("returns an empty roster for an empty array", () => {
    expect(buildRosterFromAlumnoHorarios([])).toEqual([]);
  });

  it("stringifies personaId for use as a stable React key / POST payload id", () => {
    const roster = buildRosterFromAlumnoHorarios(alumnoHorarios);
    expect(roster.every((s) => typeof s.id === "string")).toBe(true);
  });

  // Regression: re-opening the "Tomar asistencia" wizard for a session that
  // already has recorded attendance must pre-select the existing estado
  // instead of always defaulting to "absent" — the bug that made
  // resubmitting duplicate/flip already-present students to absent.
  it("pre-selects the existing record's estado for a student who already has one for this session", () => {
    const existingRecords: AttendanceRecord[] = [
      {
        id: "att-1",
        fecha: "2026-07-23",
        horario: "Lunes 18:00 — 19:00",
        personaId: 3,
        estudiante: "Sofia Alumna",
        estado: "present",
        entrenador: "Coach Torres",
      },
    ];
    const roster = buildRosterFromAlumnoHorarios(alumnoHorarios, existingRecords);
    expect(roster).toEqual([
      { id: "3", name: "Sofia Alumna", attendance: "present" },
      { id: "7", name: "Mateo Rodríguez", attendance: UNMARKED },
    ]);
  });

  it("defaults to unmarked when no existing record matches a student's personaId", () => {
    const existingRecords: AttendanceRecord[] = [
      {
        id: "att-1",
        fecha: "2026-07-23",
        horario: "Lunes 18:00 — 19:00",
        personaId: 999,
        estudiante: "Someone Else",
        estado: "present",
        entrenador: "Coach Torres",
      },
    ];
    const roster = buildRosterFromAlumnoHorarios(alumnoHorarios, existingRecords);
    expect(roster.every((s) => s.attendance === UNMARKED)).toBe(true);
  });

  it("still defaults to unmarked when existingRecords is omitted", () => {
    const roster = buildRosterFromAlumnoHorarios(alumnoHorarios);
    expect(roster.every((s) => s.attendance === UNMARKED)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `unmarked` sentinel — frontend-only initial state. The backend contract
// (`AttendanceStudentMark.estado`) only accepts the four real
// `EstadoAsistencia` values, so `unmarked` must never reach a payload.
// ---------------------------------------------------------------------------

describe("countUnmarked", () => {
  it("counts every student still on the unmarked sentinel", () => {
    const students: SessionStudent[] = [
      { id: "a", name: "A", attendance: UNMARKED },
      { id: "b", name: "B", attendance: "present" },
      { id: "c", name: "C", attendance: UNMARKED },
      { id: "d", name: "D", attendance: "absent" },
    ];
    expect(countUnmarked(students)).toBe(2);
  });

  it("returns 0 for a fully marked roster", () => {
    const students: SessionStudent[] = [
      { id: "a", name: "A", attendance: "present" },
      { id: "b", name: "B", attendance: "absent" },
    ];
    expect(countUnmarked(students)).toBe(0);
  });

  it("returns 0 for an empty roster", () => {
    expect(countUnmarked([])).toBe(0);
  });

  // A marked-absent student is a deliberate decision; an unmarked one is not.
  // Conflating the two is exactly the bug this sentinel exists to prevent.
  it("does not count a student explicitly marked absent", () => {
    expect(countUnmarked([{ id: "a", name: "A", attendance: "absent" }])).toBe(0);
  });
});

describe("markUnmarkedAsPresent", () => {
  it("promotes only the unmarked students to present", () => {
    const students: SessionStudent[] = [
      { id: "a", name: "A", attendance: UNMARKED },
      { id: "b", name: "B", attendance: "absent" },
      { id: "c", name: "C", attendance: UNMARKED },
      { id: "d", name: "D", attendance: "late" },
    ];
    expect(markUnmarkedAsPresent(students)).toEqual([
      { id: "a", name: "A", attendance: "present" },
      { id: "b", name: "B", attendance: "absent" },
      { id: "c", name: "C", attendance: "present" },
      { id: "d", name: "D", attendance: "late" },
    ]);
  });

  it("leaves an already fully marked roster untouched", () => {
    const students: SessionStudent[] = [
      { id: "a", name: "A", attendance: "justified" },
      { id: "b", name: "B", attendance: "absent" },
    ];
    expect(markUnmarkedAsPresent(students)).toEqual(students);
  });

  it("does not mutate the input array", () => {
    const students: SessionStudent[] = [{ id: "a", name: "A", attendance: UNMARKED }];
    markUnmarkedAsPresent(students);
    expect(students[0].attendance).toBe(UNMARKED);
  });
});

describe("toAttendanceMarks", () => {
  it("maps marked students to the backend payload shape", () => {
    const students: SessionStudent[] = [
      { id: "3", name: "Sofia", attendance: "present" },
      { id: "7", name: "Mateo", attendance: "justified" },
    ];
    expect(toAttendanceMarks(students)).toEqual([
      { personaId: 3, estado: "present" },
      { personaId: 7, estado: "justified" },
    ]);
  });

  // Defense in depth: the wizard already blocks submission while any student
  // is unmarked, but the sentinel must never survive into a POST body even if
  // that gate is ever bypassed — the backend would reject the whole batch.
  it("drops unmarked students instead of sending the sentinel to the backend", () => {
    const students: SessionStudent[] = [
      { id: "3", name: "Sofia", attendance: "present" },
      { id: "7", name: "Mateo", attendance: UNMARKED },
    ];
    expect(toAttendanceMarks(students)).toEqual([{ personaId: 3, estado: "present" }]);
  });

  it("returns an empty payload for an empty roster", () => {
    expect(toAttendanceMarks([])).toEqual([]);
  });
});

describe("countByState / buildAttendanceSummary with unmarked students", () => {
  const students: SessionStudent[] = [
    { id: "a", name: "A", attendance: "present" },
    { id: "b", name: "B", attendance: UNMARKED },
    { id: "c", name: "C", attendance: UNMARKED },
  ];

  it("never counts an unmarked student as absent", () => {
    expect(countByState(students, "absent")).toBe(0);
    expect(countByState(students, "present")).toBe(1);
  });

  it("omits unmarked students from the human-readable summary counts", () => {
    expect(buildAttendanceSummary(students)).toBe(
      "1 presente • 0 ausente • 0 tardanza • 0 justificado",
    );
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
