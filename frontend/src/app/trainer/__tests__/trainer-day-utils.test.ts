import { describe, it, expect } from "vitest";
import type { AttendanceRecord, TrainingSchedule } from "@/app/attendance/attendance-utils";
import {
  ABSENCE_ALERT_THRESHOLD,
  buildSessionBarAriaLabel,
  buildSessionBarSegments,
  buildSessionCardState,
  findAbsenceAlert,
  formatAbsenceCount,
  formatElapsedMinutes,
  formatEnrolledCount,
  groupRecordsBySession,
  minutesSinceMidnight,
  minutesUntilStart,
  monthToDateRange,
  parseHoraToMinutes,
  selectTodaySessions,
} from "@/app/trainer/trainer-day-utils";

function schedule(
  id: number,
  horaInicio: string,
  horaFin: string,
): TrainingSchedule {
  return {
    id,
    diaSemana: "lun",
    horaInicio,
    horaFin,
  };
}

function record(
  partial: Partial<AttendanceRecord> & Pick<AttendanceRecord, "estado">,
): AttendanceRecord {
  return {
    id: partial.id ?? Math.random().toString(36),
    fecha: partial.fecha ?? "2026-07-23",
    horario: partial.horario ?? "Lunes 15:00 — 16:00",
    horarioId: partial.horarioId ?? 1,
    personaId: partial.personaId ?? 1,
    estudiante: partial.estudiante ?? "Ana López",
    estado: partial.estado,
  };
}

/** 2026-07-23 at 14:35 local. */
const NOW = new Date(2026, 6, 23, 14, 35);

describe("parseHoraToMinutes", () => {
  it("reads HH:mm and HH:mm:ss alike", () => {
    expect(parseHoraToMinutes("15:00")).toBe(900);
    expect(parseHoraToMinutes("15:00:00")).toBe(900);
    expect(parseHoraToMinutes("09:30")).toBe(570);
    expect(parseHoraToMinutes("9:30")).toBe(570);
  });

  it("returns null for anything that is not a time, rather than 0", () => {
    // 0 would read as midnight and quietly sort a broken row to the front.
    expect(parseHoraToMinutes("")).toBeNull();
    expect(parseHoraToMinutes("mañana")).toBeNull();
    expect(parseHoraToMinutes("25:00")).toBeNull();
    expect(parseHoraToMinutes("15:75")).toBeNull();
  });
});

describe("minutesSinceMidnight", () => {
  it("uses local clock components", () => {
    expect(minutesSinceMidnight(NOW)).toBe(14 * 60 + 35);
  });
});

describe("selectTodaySessions", () => {
  it("picks the next session and lists what follows, in start order", () => {
    const result = selectTodaySessions(
      [schedule(3, "17:00", "18:00"), schedule(1, "15:00", "16:00"), schedule(2, "16:00", "17:00")],
      NOW,
    );

    expect(result.next?.id).toBe(1);
    expect(result.later.map((s) => s.horaInicio)).toEqual(["16:00", "17:00"]);
  });

  it("keeps a session that has already started as the next one", () => {
    // 15:30 — the 15:00 session is running. The trainer is heading to THAT
    // session, not to the 16:00 one.
    const result = selectTodaySessions(
      [schedule(1, "15:00", "16:00"), schedule(2, "16:00", "17:00")],
      new Date(2026, 6, 23, 15, 30),
    );

    expect(result.next?.id).toBe(1);
    expect(result.later.map((s) => s.id)).toEqual([2]);
  });

  it("drops a session that has already finished", () => {
    const result = selectTodaySessions(
      [schedule(1, "15:00", "16:00"), schedule(2, "16:00", "17:00")],
      new Date(2026, 6, 23, 16, 15),
    );

    expect(result.next?.id).toBe(2);
    expect(result.later).toEqual([]);
  });

  it("returns nothing once the day's last session is over", () => {
    const result = selectTodaySessions(
      [schedule(1, "15:00", "16:00")],
      new Date(2026, 6, 23, 21, 0),
    );

    expect(result.next).toBeNull();
    expect(result.later).toEqual([]);
  });

  it("returns nothing for an empty day", () => {
    expect(selectTodaySessions([], NOW)).toEqual({ next: null, later: [] });
  });

  it("does not mutate the caller's array", () => {
    const input = [schedule(2, "17:00", "18:00"), schedule(1, "15:00", "16:00")];
    selectTodaySessions(input, NOW);
    expect(input.map((s) => s.id)).toEqual([2, 1]);
  });
});

describe("minutesUntilStart", () => {
  it("counts forward to a session that has not started", () => {
    expect(minutesUntilStart(schedule(1, "15:00", "16:00"), NOW)).toBe(25);
  });

  it("goes negative for a session already running", () => {
    expect(minutesUntilStart(schedule(1, "14:00", "15:00"), NOW)).toBe(-35);
  });
});

describe("formatEnrolledCount", () => {
  it("says inscritos, not esperan — the backend only knows who is enrolled", () => {
    expect(formatEnrolledCount(12)).toBe("12 estudiantes inscritos");
    expect(formatEnrolledCount(1)).toBe("1 estudiante inscrito");
    expect(formatEnrolledCount(0)).toBe("0 estudiantes inscritos");
  });

  it("says nothing at all while the count is unknown", () => {
    expect(formatEnrolledCount(null)).toBeNull();
  });
});

describe("groupRecordsBySession", () => {
  it("groups by fecha + horario and counts each state", () => {
    const sessions = groupRecordsBySession([
      record({ estado: "present", estudiante: "A" }),
      record({ estado: "present", estudiante: "B" }),
      record({ estado: "late", estudiante: "C" }),
      record({ estado: "absent", estudiante: "D" }),
      record({ estado: "justified", estudiante: "E" }),
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].counts).toEqual({ present: 2, late: 1, absent: 1, justified: 1 });
    expect(sessions[0].total).toBe(5);
  });

  it("carries the horario's raw id, not only its label", () => {
    // What makes a session addressable. A label cannot be turned back into
    // the horario it describes, so without this the row knows which session
    // it summarises but cannot say so to anything but a human.
    const sessions = groupRecordsBySession([
      record({ estado: "present", horarioId: 7, fecha: "2026-07-20" }),
    ]);

    expect(sessions[0].horarioId).toBe(7);
  });

  it("separates two horarios on the same day", () => {
    const sessions = groupRecordsBySession([
      record({ estado: "present", horarioId: 1, horario: "Lunes 15:00 — 16:00" }),
      record({ estado: "absent", horarioId: 2, horario: "Lunes 17:00 — 18:00" }),
    ]);

    expect(sessions).toHaveLength(2);
    // Later horario first — most recent session at the top.
    expect(sessions[0].horario).toBe("Lunes 17:00 — 18:00");
  });

  it("keeps two same-labelled horarios apart, because the id is the identity", () => {
    // Two Horario rows CAN render the same "Lunes 15:00 — 16:00" label: the
    // label is day + times, and nothing in the schema forbids a second horario
    // with both. Grouping on the label would merge them into one row whose
    // "Corregir" pointed at whichever horario happened to be read first.
    const sessions = groupRecordsBySession([
      record({ estado: "present", horarioId: 3, horario: "Lunes 15:00 — 16:00" }),
      record({ estado: "absent", horarioId: 4, horario: "Lunes 15:00 — 16:00" }),
    ]);

    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.horarioId).sort()).toEqual([3, 4]);
  });

  it("orders most recent day first", () => {
    const sessions = groupRecordsBySession([
      record({ estado: "present", fecha: "2026-07-20" }),
      record({ estado: "present", fecha: "2026-07-23" }),
      record({ estado: "present", fecha: "2026-07-21" }),
    ]);

    expect(sessions.map((s) => s.fecha)).toEqual(["2026-07-23", "2026-07-21", "2026-07-20"]);
  });

  it("returns an empty list rather than throwing on no records", () => {
    expect(groupRecordsBySession([])).toEqual([]);
  });
});

describe("findAbsenceAlert", () => {
  it("surfaces the student with the most absences once the threshold is reached", () => {
    const alert = findAbsenceAlert([
      record({ estado: "absent", estudiante: "Luis Lopez" }),
      record({ estado: "absent", estudiante: "Luis Lopez" }),
      record({ estado: "absent", estudiante: "Luis Lopez" }),
      record({ estado: "absent", estudiante: "Ana López" }),
    ]);

    expect(alert).toEqual({ estudiante: "Luis Lopez", ausencias: 3 });
  });

  it("stays quiet below the threshold — one absence is an event, not a pattern", () => {
    expect(ABSENCE_ALERT_THRESHOLD).toBe(2);
    expect(findAbsenceAlert([record({ estado: "absent", estudiante: "Ana López" })])).toBeNull();
  });

  it("ignores justified absences, which the club already knows about", () => {
    const alert = findAbsenceAlert([
      record({ estado: "justified", estudiante: "Ana López" }),
      record({ estado: "justified", estudiante: "Ana López" }),
      record({ estado: "late", estudiante: "Ana López" }),
    ]);

    expect(alert).toBeNull();
  });

  it("breaks ties alphabetically so the panel does not reshuffle between refreshes", () => {
    const alert = findAbsenceAlert([
      record({ estado: "absent", estudiante: "Zoe Vera" }),
      record({ estado: "absent", estudiante: "Zoe Vera" }),
      record({ estado: "absent", estudiante: "Ana López" }),
      record({ estado: "absent", estudiante: "Ana López" }),
    ]);

    expect(alert?.estudiante).toBe("Ana López");
  });

  it("returns null for no records", () => {
    expect(findAbsenceAlert([])).toBeNull();
  });
});

describe("formatAbsenceCount", () => {
  it("pluralizes", () => {
    expect(formatAbsenceCount(1)).toBe("1 ausencia");
    expect(formatAbsenceCount(3)).toBe("3 ausencias");
  });
});

// ---------------------------------------------------------------------------
// The immediate-session card (issue #211): the number that decides depends on
// whether the session has started, and the primary action's href must call
// the wizard's real query contract (`buildWizardQuery` /
// `attendance-utils.ts`), never a hand-built string.
// ---------------------------------------------------------------------------

describe("buildSessionCardState", () => {
  it("is null on a day with no schedules at all — the card does not render", () => {
    expect(buildSessionCardState([], NOW)).toBeNull();
  });

  it("answers 'next' before the session starts, with the countdown and the wizard href", () => {
    const state = buildSessionCardState([schedule(1, "15:00", "16:00")], NOW);

    expect(state).not.toBeNull();
    expect(state?.kind).toBe("next");
    if (state?.kind !== "next") throw new Error("expected next");
    expect(state.schedule.id).toBe(1);
    expect(state.minutesAway).toBe(25);
    // `paso=lista` and no `fecha` — today needs no address (attendance-utils.ts).
    expect(state.href).toBe("/trainer/attendance?horario=1&paso=lista");
  });

  it("switches to 'live' once the session has started — the hour becomes the identifier", () => {
    const state = buildSessionCardState(
      [schedule(1, "14:00", "16:00")],
      new Date(2026, 6, 23, 14, 10),
    );

    expect(state?.kind).toBe("live");
    if (state?.kind !== "live") throw new Error("expected live");
    expect(state.schedule.id).toBe(1);
    expect(state.minutesElapsed).toBe(10);
    expect(state.href).toBe("/trainer/attendance?horario=1&paso=lista");
  });

  it("answers 'done', carrying no href at all, once every session today has ended", () => {
    const state = buildSessionCardState(
      [schedule(1, "10:00", "11:00")],
      new Date(2026, 6, 23, 21, 0),
    );

    expect(state).toEqual({ kind: "done" });
    expect(state && "href" in state).toBe(false);
  });

  it("picks the session already in progress, not a later one still to come", () => {
    const state = buildSessionCardState(
      [schedule(1, "14:00", "15:00"), schedule(2, "16:00", "17:00")],
      new Date(2026, 6, 23, 14, 30),
    );

    expect(state?.kind).toBe("live");
    if (state?.kind !== "live") throw new Error("expected live");
    expect(state.schedule.id).toBe(1);
  });
});

describe("formatElapsedMinutes", () => {
  it("pluralizes", () => {
    expect(formatElapsedMinutes(1)).toBe("Hace 1 minuto");
    expect(formatElapsedMinutes(10)).toBe("Hace 10 minutos");
  });

  it("says the session just started rather than 'hace 0 minutos'", () => {
    expect(formatElapsedMinutes(0)).toBe("Recién empezó");
  });
});

// ---------------------------------------------------------------------------
// "Últimas listas" proportional bar (issue #211): color is reserved for
// badges/pills, so the four counts render as a bar whose `aria-label` always
// states the four values and the total.
// ---------------------------------------------------------------------------

describe("buildSessionBarSegments", () => {
  it("returns the four states in the fixed reading order, with a share of the total", () => {
    const segments = buildSessionBarSegments(
      { present: 9, late: 1, justified: 1, absent: 1 },
      12,
    );

    expect(segments.map((s) => s.estado)).toEqual(["present", "late", "justified", "absent"]);
    expect(segments.map((s) => s.count)).toEqual([9, 1, 1, 1]);
    expect(segments[0].widthPercent).toBeCloseTo(75, 5);
    expect(segments[1].widthPercent).toBeCloseTo(100 / 12, 5);
  });

  it("returns zero widths rather than dividing by zero when the session has no records", () => {
    const segments = buildSessionBarSegments(
      { present: 0, late: 0, justified: 0, absent: 0 },
      0,
    );

    expect(segments.every((s) => s.widthPercent === 0)).toBe(true);
  });
});

describe("buildSessionBarAriaLabel", () => {
  it("enunciates all four counts and the total, singular/plural agreeing with each count", () => {
    expect(buildSessionBarAriaLabel({ present: 9, late: 1, justified: 1, absent: 1 }, 12)).toBe(
      "9 presentes, 1 tardanza, 1 justificado y 1 ausente sobre 12 registros",
    );
  });

  it("still names a state at zero, rather than omitting it", () => {
    expect(buildSessionBarAriaLabel({ present: 8, late: 1, justified: 0, absent: 1 }, 10)).toBe(
      "8 presentes, 1 tardanza, 0 justificados y 1 ausente sobre 10 registros",
    );
  });
});

describe("monthToDateRange", () => {
  // Date formatting itself is `@/lib/club-date`'s contract and is tested
  // there, in club time. What matters here is only that this alias still
  // spans first-of-month through the reference day.
  it("spans the first of the month through the reference day", () => {
    // An explicit instant, not a local-components `Date`: the range resolves
    // in club time, so a fixture built from the runner's zone would drift on
    // any machine far enough from Ecuador.
    expect(monthToDateRange(new Date("2026-07-23T17:00:00Z"))).toEqual({
      fechaInicio: "2026-07-01",
      fechaFin: "2026-07-23",
    });
  });
});
