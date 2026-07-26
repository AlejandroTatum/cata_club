/**
 * Unit tests for Trainer Attendance utilities.
 *
 * Pure functions — no React dependencies. The draft-persistence block at the
 * bottom needs `sessionStorage`, hence the jsdom environment.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UNMARKED,
  nextAttendanceState,
  cycleWizardAttendance,
  resolveFailedStudentNames,
  attendanceDraftKey,
  buildWizardQuery,
  listAttendanceDrafts,
  parseWizardQuery,
  toAttendanceDraft,
  WIZARD_STEP_ORDER,
  parseAttendanceDraft,
  applyAttendanceDraft,
  saveAttendanceDraft,
  loadAttendanceDraft,
  clearAttendanceDraft,
  countByState,
  countUnmarked,
  countUnreviewed,
  isReviewed,
  markRemainingPresent,
  tapWizardAttendance,
  DEFAULT_ATTENDANCE,
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

  // The roster starts on "present" (`DEFAULT_ATTENDANCE`) — a session is
  // overwhelmingly "everyone showed up", and starting from nothing turned 40
  // students into 40 obligatory taps.
  //
  // The silent-data-loss risk that the old `unmarked` default guarded against
  // did not go away, it inverted: filing students as present without looking
  // at them is the same defect pointing the other way. So the VALUE is not the
  // DECISION — every row starts NOT reviewed, and that is what the roll call
  // counts, flags and reports. See `countUnreviewed`.
  it("maps each alumno-horario row to a SessionStudent defaulted to present but NOT reviewed", () => {
    const roster = buildRosterFromAlumnoHorarios(alumnoHorarios);
    expect(roster).toEqual([
      { id: "3", name: "Sofia Alumna", attendance: "present", reviewed: false },
      { id: "7", name: "Mateo Rodríguez", attendance: "present", reviewed: false },
    ]);
    expect(roster.every((s) => s.attendance === DEFAULT_ATTENDANCE)).toBe(true);
    expect(countUnreviewed(roster)).toBe(2);
  });

  // The one thing the new default must never do: reach the wire, or the
  // confirmation summary, as if a human had chosen it.
  it("never produces the unmarked sentinel", () => {
    expect(countUnmarked(buildRosterFromAlumnoHorarios(alumnoHorarios))).toBe(0);
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
    // A saved record IS a decision somebody made for this session, so that row
    // comes back reviewed; the student with no record does not.
    expect(roster).toEqual([
      { id: "3", name: "Sofia Alumna", attendance: "present", reviewed: true },
      { id: "7", name: "Mateo Rodríguez", attendance: "present", reviewed: false },
    ]);
  });

  it("defaults to present-but-unreviewed when no existing record matches a student's personaId", () => {
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
    expect(roster.every((s) => s.attendance === "present")).toBe(true);
    expect(roster.every((s) => !isReviewed(s))).toBe(true);
  });

  it("still defaults to present-but-unreviewed when existingRecords is omitted", () => {
    const roster = buildRosterFromAlumnoHorarios(alumnoHorarios);
    expect(roster.every((s) => s.attendance === "present")).toBe(true);
    expect(countUnreviewed(roster)).toBe(roster.length);
  });
});

// ---------------------------------------------------------------------------
// `reviewed` — the flag that keeps the "everyone starts present" default from
// becoming "everyone was filed present and nobody looked".
// ---------------------------------------------------------------------------

describe("countUnreviewed / isReviewed", () => {
  const roster: SessionStudent[] = [
    { id: "a", name: "A", attendance: "present", reviewed: true },
    { id: "b", name: "B", attendance: "present", reviewed: false },
    { id: "c", name: "C", attendance: "absent", reviewed: true },
    { id: "d", name: "D", attendance: "present" },
  ];

  it("counts every row no human has touched, whatever state it carries", () => {
    expect(countUnreviewed(roster)).toBe(2);
  });

  // A row that merely LOOKS decided is not: this is the whole distinction the
  // present-by-default roster rests on.
  it("does not count a present row as reviewed just because it says present", () => {
    expect(isReviewed({ id: "x", name: "X", attendance: "present" })).toBe(false);
  });

  // An omitted flag has to read as the cautious answer, never the reassuring
  // one — a `SessionStudent` built without it must not claim to be reviewed.
  it("treats a missing flag as not reviewed", () => {
    expect(isReviewed(roster[3])).toBe(false);
  });

  it("returns 0 for an empty roster", () => {
    expect(countUnreviewed([])).toBe(0);
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

describe("markRemainingPresent", () => {
  it("promotes every unreviewed student to present and marks them reviewed", () => {
    const students: SessionStudent[] = [
      { id: "a", name: "A", attendance: "present", reviewed: false },
      { id: "b", name: "B", attendance: "absent", reviewed: true },
      { id: "c", name: "C", attendance: UNMARKED },
      { id: "d", name: "D", attendance: "late", reviewed: true },
    ];
    expect(markRemainingPresent(students)).toEqual([
      { id: "a", name: "A", attendance: "present", reviewed: true },
      { id: "b", name: "B", attendance: "absent", reviewed: true },
      { id: "c", name: "C", attendance: "present", reviewed: true },
      { id: "d", name: "D", attendance: "late", reviewed: true },
    ]);
  });

  // The button is how a trainer says "I looked, the rest are here". If it left
  // those rows unreviewed, the confirmation step would keep flagging a roster
  // the trainer had just explicitly signed off on.
  it("clears the unreviewed count outright", () => {
    const students: SessionStudent[] = [
      { id: "a", name: "A", attendance: "present" },
      { id: "b", name: "B", attendance: "present" },
    ];
    expect(countUnreviewed(markRemainingPresent(students))).toBe(0);
  });

  it("leaves a roster the trainer already went through untouched", () => {
    const students: SessionStudent[] = [
      { id: "a", name: "A", attendance: "justified", reviewed: true },
      { id: "b", name: "B", attendance: "absent", reviewed: true },
    ];
    expect(markRemainingPresent(students)).toEqual(students);
  });

  it("does not mutate the input array", () => {
    const students: SessionStudent[] = [{ id: "a", name: "A", attendance: UNMARKED }];
    markRemainingPresent(students);
    expect(students[0].attendance).toBe(UNMARKED);
    expect(students[0].reviewed).toBeUndefined();
  });
});

describe("tapWizardAttendance", () => {
  // Tapping the row of a student standing right in front of you means "yes,
  // that one" — advancing them to Tardanza for saying so would be the opposite
  // of what the trainer did, and would cost four taps to undo.
  it("confirms the default instead of moving off it on the first tap", () => {
    expect(tapWizardAttendance({ id: "a", name: "A", attendance: "present" })).toBe("present");
  });

  it("cycles normally once the row has been reviewed", () => {
    expect(
      tapWizardAttendance({ id: "a", name: "A", attendance: "present", reviewed: true }),
    ).toBe("late");
  });

  it("cycles an unmarked row straight away — there is nothing there to confirm", () => {
    expect(tapWizardAttendance({ id: "a", name: "A", attendance: UNMARKED })).toBe("present");
  });

  it("never returns the sentinel", () => {
    const seen = new Set<string>();
    let student: SessionStudent = { id: "a", name: "A", attendance: "present" };
    for (let i = 0; i < 8; i += 1) {
      const next = tapWizardAttendance(student);
      expect(next).not.toBe(UNMARKED);
      seen.add(next);
      student = { ...student, attendance: next, reviewed: true };
    }
    expect(seen).toEqual(new Set(["present", "late", "justified", "absent"]));
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

// ---------------------------------------------------------------------------
// Row tapping (FASE 4 item 3): the whole 48px fiche cycles the state.
// ---------------------------------------------------------------------------

describe("cycleWizardAttendance", () => {
  it("walks the prototype's order, starting at the common answer", () => {
    expect(cycleWizardAttendance(UNMARKED)).toBe("present");
    expect(cycleWizardAttendance("present")).toBe("late");
    expect(cycleWizardAttendance("late")).toBe("justified");
    expect(cycleWizardAttendance("justified")).toBe("absent");
  });

  it("loops back to present, never back to unmarked", () => {
    // Tapping is an accelerator over the four explicit controls. If it could
    // un-decide a student it would hand back the exact ambiguity `UNMARKED`
    // exists to remove.
    expect(cycleWizardAttendance("absent")).toBe("present");

    let state: ReturnType<typeof cycleWizardAttendance> | typeof UNMARKED = UNMARKED;
    for (let i = 0; i < 12; i++) {
      state = cycleWizardAttendance(state);
      expect(state).not.toBe(UNMARKED);
    }
  });
});

// ---------------------------------------------------------------------------
// Partial-failure reporting: name the students, do not just count them.
// ---------------------------------------------------------------------------

describe("resolveFailedStudentNames", () => {
  const roster: SessionStudent[] = [
    { id: "9", name: "Ana López", attendance: "present" },
    { id: "10", name: "Luis Lopez", attendance: "absent" },
  ];

  it("maps persona ids back to the names the trainer just worked through", () => {
    expect(
      resolveFailedStudentNames([{ personaId: 10 }, { personaId: 9 }], roster),
    ).toEqual(["Luis Lopez", "Ana López"]);
  });

  it("falls back to the id rather than dropping an unknown student", () => {
    // A partially named failure is still more actionable than a bare count.
    expect(resolveFailedStudentNames([{ personaId: 404 }], roster)).toEqual(["Alumno #404"]);
  });

  it("returns an empty list when nothing failed", () => {
    expect(resolveFailedStudentNames([], roster)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Draft persistence. Every test here is really one question: can a draft ever
// weaken the "no student goes out on a state the trainer did not choose"
// guarantee? The answer has to stay no.
// ---------------------------------------------------------------------------

describe("attendanceDraftKey", () => {
  it("scopes a draft to its own horario and date", () => {
    expect(attendanceDraftKey(12, "2026-07-20")).toBe("cata_attendance_draft:12:2026-07-20");
    // Yesterday's draft can never be replayed onto today's session.
    expect(attendanceDraftKey(12, "2026-07-20")).not.toBe(attendanceDraftKey(12, "2026-07-21"));
    expect(attendanceDraftKey(12, "2026-07-20")).not.toBe(attendanceDraftKey(13, "2026-07-20"));
  });
});

describe("toAttendanceDraft", () => {
  it("stores the states a human chose and omits the rest entirely", () => {
    expect(
      toAttendanceDraft([
        { id: "1", name: "A", attendance: "present", reviewed: true },
        { id: "2", name: "B", attendance: UNMARKED },
        { id: "3", name: "C", attendance: "justified", reviewed: true },
      ]),
    ).toEqual({ "1": "present", "3": "justified" });
  });

  // Persisting an untouched row would let a page refresh launder "nobody
  // looked" into "confirmed present": the draft would come back, the restore
  // would mark it reviewed, and the confirmation step would stop warning about
  // a student the trainer still has not seen.
  it("does not persist a row that is still on the default", () => {
    expect(
      toAttendanceDraft([
        { id: "1", name: "A", attendance: "present" },
        { id: "2", name: "B", attendance: "present", reviewed: false },
      ]),
    ).toEqual({});
  });

  it("never writes the sentinel", () => {
    const draft = toAttendanceDraft([
      { id: "1", name: "A", attendance: UNMARKED, reviewed: true },
    ]);
    expect(Object.values(draft)).not.toContain(UNMARKED);
    expect(draft).toEqual({});
  });
});

describe("parseAttendanceDraft", () => {
  it("round-trips a valid draft", () => {
    expect(parseAttendanceDraft('{"1":"present","2":"absent"}')).toEqual({
      "1": "present",
      "2": "absent",
    });
  });

  it("drops entries that are not one of the four real states", () => {
    // Notably `unmarked` itself: a hand-edited draft must not be able to
    // reintroduce the sentinel through storage.
    expect(parseAttendanceDraft('{"1":"present","2":"unmarked","3":"banana"}')).toEqual({
      "1": "present",
    });
  });

  it("returns null for anything that is not a plain object", () => {
    expect(parseAttendanceDraft(null)).toBeNull();
    expect(parseAttendanceDraft("")).toBeNull();
    expect(parseAttendanceDraft("not json")).toBeNull();
    expect(parseAttendanceDraft("[1,2,3]")).toBeNull();
    expect(parseAttendanceDraft("null")).toBeNull();
    expect(parseAttendanceDraft('"present"')).toBeNull();
  });
});

describe("applyAttendanceDraft", () => {
  const roster: SessionStudent[] = [
    { id: "1", name: "A", attendance: "present", reviewed: false },
    { id: "2", name: "B", attendance: "present", reviewed: false },
    { id: "3", name: "C", attendance: "present", reviewed: true },
  ];

  it("restores the marks the trainer had already made", () => {
    const result = applyAttendanceDraft(roster, { "1": "late" });
    expect(result[0].attendance).toBe("late");
  });

  // A drafted entry only got there because a human made it, so it comes back
  // as a decision — otherwise recovering from a phone call would silently
  // demote every mark the trainer had made back to "nobody looked".
  it("restores a drafted student as reviewed", () => {
    const result = applyAttendanceDraft(roster, { "1": "late" });
    expect(isReviewed(result[0])).toBe(true);
  });

  it("leaves students the draft does not mention exactly as they were", () => {
    const result = applyAttendanceDraft(roster, { "1": "late" });
    expect(result[1].attendance).toBe("present");
    expect(isReviewed(result[1])).toBe(false);
    expect(result[2].attendance).toBe("present");
  });

  it("cannot introduce a student who is not on the roster", () => {
    const result = applyAttendanceDraft(roster, { "999": "present" });
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.id)).toEqual(["1", "2", "3"]);
  });

  it("returns the roster untouched for a null draft", () => {
    expect(applyAttendanceDraft(roster, null)).toBe(roster);
  });

  it("never mutates the input roster", () => {
    applyAttendanceDraft(roster, { "1": "absent" });
    expect(roster[0].attendance).toBe("present");
    expect(isReviewed(roster[0])).toBe(false);
  });

  it("leaves nobody unreviewed after a full-roster draft", () => {
    const result = applyAttendanceDraft(roster, { "1": "present", "2": "absent", "3": "late" });
    expect(countUnmarked(result)).toBe(0);
    expect(countUnreviewed(result)).toBe(0);
  });
});

describe("saveAttendanceDraft / loadAttendanceDraft / clearAttendanceDraft", () => {
  const KEY = "cata_attendance_draft:12:2026-07-20";

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("round-trips through sessionStorage", () => {
    saveAttendanceDraft(KEY, [
      { id: "1", name: "A", attendance: "present", reviewed: true },
      { id: "2", name: "B", attendance: UNMARKED },
      // Still on the default: not a decision, so not the draft's business.
      { id: "3", name: "C", attendance: "present" },
    ]);

    expect(loadAttendanceDraft(KEY)).toEqual({ "1": "present" });
  });

  it("returns null for a key that was never written", () => {
    expect(loadAttendanceDraft("cata_attendance_draft:99:2026-01-01")).toBeNull();
  });

  it("forgets the draft once it is cleared", () => {
    saveAttendanceDraft(KEY, [{ id: "1", name: "A", attendance: "present", reviewed: true }]);
    expect(loadAttendanceDraft(KEY)).toEqual({ "1": "present" });
    clearAttendanceDraft(KEY);
    expect(loadAttendanceDraft(KEY)).toBeNull();
  });

  it("survives a storage that throws instead of taking the roll call down", () => {
    // Private browsing and quota errors both surface this way. Losing draft
    // persistence must never take the roll call itself down.
    const real = window.sessionStorage;
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        getItem: () => {
          throw new Error("SecurityError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      },
    });

    expect(() =>
      saveAttendanceDraft(KEY, [{ id: "1", name: "A", attendance: "present", reviewed: true }]),
    ).not.toThrow();
    expect(loadAttendanceDraft(KEY)).toBeNull();
    expect(() => clearAttendanceDraft(KEY)).not.toThrow();

    Object.defineProperty(window, "sessionStorage", { configurable: true, value: real });
  });
});

describe("listAttendanceDrafts", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("finds today's drafts and describes what is in them", () => {
    saveAttendanceDraft("cata_attendance_draft:12:2026-07-20", [
      { id: "1", name: "A", attendance: "late", reviewed: true },
      { id: "2", name: "B", attendance: "absent", reviewed: true },
      // Untouched: never in the draft, so never in the count either.
      { id: "3", name: "C", attendance: "present" },
    ]);

    expect(listAttendanceDrafts("2026-07-20")).toEqual([
      { key: "cata_attendance_draft:12:2026-07-20", horarioId: 12, fecha: "2026-07-20", markCount: 2 },
    ]);
  });

  it("never offers a draft from another date", () => {
    saveAttendanceDraft("cata_attendance_draft:12:2026-07-19", [
      { id: "1", name: "A", attendance: "late", reviewed: true },
    ]);

    expect(listAttendanceDrafts("2026-07-20")).toEqual([]);
  });

  it("ignores a draft nobody actually decided anything in", () => {
    // A roster where every row is still the default writes an empty draft —
    // there is nothing to resume, and offering to "retomar" it would be
    // offering the trainer their own untouched list back.
    saveAttendanceDraft("cata_attendance_draft:12:2026-07-20", [
      { id: "1", name: "A", attendance: "present" },
    ]);

    expect(listAttendanceDrafts("2026-07-20")).toEqual([]);
  });

  it("leaves unrelated storage keys alone", () => {
    window.sessionStorage.setItem("cata_session", "{}");
    window.sessionStorage.setItem("cata_attendance_draft:not-a-number:2026-07-20", '{"1":"late"}');

    expect(listAttendanceDrafts("2026-07-20")).toEqual([]);
  });
});

describe("parseWizardQuery / buildWizardQuery", () => {
  it("round-trips each step", () => {
    for (const step of WIZARD_STEP_ORDER) {
      const query = buildWizardQuery(step === "select-session" ? null : 12, step);
      expect(parseWizardQuery(query)).toEqual({
        horarioId: step === "select-session" ? null : 12,
        step,
      });
    }
  });

  it("keeps the start of the flow at the bare URL", () => {
    expect(buildWizardQuery(null, "select-session")).toBe("");
    expect(buildWizardQuery(12, "mark-attendance")).toBe("?horario=12&paso=lista");
    expect(buildWizardQuery(12, "confirm")).toBe("?horario=12&paso=confirmar");
  });

  it("refuses a step that has no horario to belong to", () => {
    // A roll call for nobody is not a page — send it back to the picker.
    expect(parseWizardQuery("?paso=lista")).toEqual({ horarioId: null, step: "select-session" });
    expect(parseWizardQuery("?horario=abc&paso=lista")).toEqual({
      horarioId: null,
      step: "select-session",
    });
    expect(parseWizardQuery("?horario=0&paso=lista")).toEqual({
      horarioId: null,
      step: "select-session",
    });
  });

  it("treats an unknown step as the picker rather than guessing", () => {
    expect(parseWizardQuery("?horario=12&paso=whatever")).toEqual({
      horarioId: 12,
      step: "select-session",
    });
    expect(parseWizardQuery("")).toEqual({ horarioId: null, step: "select-session" });
  });
});
