import { describe, it, expect } from "vitest";
import type {
  AttendanceDayStats,
  AttendanceRecord,
  TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import type { AlumnoHorario } from "@/services/api";
import {
  ABSENCE_ALERT_THRESHOLD,
  buildEnrolledCountsByHorario,
  buildMonthAttendanceRate,
  buildSessionBarAriaLabel,
  buildSessionBarSegments,
  buildDayRail,
  buildSessionCardState,
  findAbsenceAlert,
  formatAbsenceCount,
  formatElapsedMinutes,
  formatMinutesAsHora,
  formatEnrolledCount,
  formatStateCount,
  formatTimeUntilStart,
  groupRecordsBySession,
  minutesSinceMidnight,
  minutesUntilStart,
  monthToDateRange,
  parseHoraToMinutes,
  selectTodaySessions,
  sumEnrolledToday,
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
    registradoPorId: partial.registradoPorId ?? null,
    registradoPorNombre: partial.registradoPorNombre ?? null,
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

  it("carries who took the list from the first record of a session (issue #263)", () => {
    const sessions = groupRecordsBySession([
      record({ estado: "present", registradoPorNombre: "Carlos Mendoza" }),
      record({ estado: "present", registradoPorNombre: "Carlos Mendoza" }),
    ]);

    expect(sessions[0].registradoPorNombre).toBe("Carlos Mendoza");
  });

  it("marks a legacy session with no taker as null, not a fabricated name", () => {
    const sessions = groupRecordsBySession([record({ estado: "present" })]);

    expect(sessions[0].registradoPorNombre).toBeNull();
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
// whether the session has started.
//
// El estado llevaba también un `href` hacia el asistente para tomar la lista,
// armado con `buildWizardQuery` para no inventar la query a mano. El asistente
// se retiró de la interfaz mientras se rehace dentro del área de miembros, así
// que ningún estado lleva href y este módulo dejó de importar nada del
// asistente — que es lo que hace que el corte sea real y no cosmético.
// ---------------------------------------------------------------------------

describe("buildSessionCardState", () => {
  it("is null on a day with no schedules at all — the card does not render", () => {
    expect(buildSessionCardState([], NOW)).toBeNull();
  });

  it("answers 'next' before the session starts, with the countdown and no href", () => {
    const state = buildSessionCardState([schedule(1, "15:00", "16:00")], NOW);

    expect(state).not.toBeNull();
    expect(state?.kind).toBe("next");
    if (state?.kind !== "next") throw new Error("expected next");
    expect(state.schedule.id).toBe(1);
    expect(state.minutesAway).toBe(25);
    // Ningún estado lleva ya un `href`: el que había apuntaba al asistente
    // para tomar la lista, que se retiró de la interfaz mientras se rehace
    // dentro del área de miembros. Se afirma la ausencia sobre el objeto, no
    // sobre el tipo, porque TypeScript no corre en producción.
    expect("href" in state).toBe(false);
    // One session today, nothing left to carousel.
    expect(state.later).toEqual([]);
  });

  it("carries every session still to come today, in start order, as 'later'", () => {
    const state = buildSessionCardState(
      [
        schedule(3, "17:00", "18:00"),
        schedule(1, "15:00", "16:00"),
        schedule(2, "16:00", "17:00"),
      ],
      NOW,
    );

    expect(state?.kind).toBe("next");
    if (state?.kind !== "next") throw new Error("expected next");
    expect(state.schedule.id).toBe(1);
    expect(state.later.map((s) => s.id)).toEqual([2, 3]);
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
    expect("href" in state).toBe(false);
    expect(state.later).toEqual([]);
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
    expect(state.later.map((s) => s.id)).toEqual([2]);
  });
});

describe("buildEnrolledCountsByHorario", () => {
  function alumno(horarioId: number): AlumnoHorario {
    return {
      id: Math.random(),
      personaId: Math.random(),
      personaNombreCompleto: "Alumno",
      edad: 12,
      horarioId,
      horarioDia: "lun",
      horarioHoraInicio: "15:00",
      horarioHoraFin: "16:00",
      fechaAsignacion: "2026-01-01",
    };
  }

  it("counts the roster per today's horario, defaulting an empty class to 0", () => {
    const today = [schedule(1, "15:00", "16:00"), schedule(2, "16:00", "17:00")];
    const roster = [alumno(1), alumno(1), alumno(1)];

    expect(buildEnrolledCountsByHorario(today, roster)).toEqual({ 1: 3, 2: 0 });
  });

  it("ignores roster rows for a horario outside today", () => {
    const today = [schedule(1, "15:00", "16:00")];
    const roster = [alumno(1), alumno(99)];

    expect(buildEnrolledCountsByHorario(today, roster)).toEqual({ 1: 1 });
  });

  it("returns an empty map for a day with no schedules", () => {
    expect(buildEnrolledCountsByHorario([], [alumno(1)])).toEqual({});
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
// The wait, in the shape of what it measures.
//
// The card used to print the raw minute count as its 46px figure, which is
// only a readable quantity for about an hour: opened at 03:20 on a day whose
// first session is at 15:00, it read "700 minutos". A wait is a duration, and
// a duration over an hour is said in hours.
// ---------------------------------------------------------------------------

describe("formatTimeUntilStart", () => {
  it("counts minutes while the wait is still countable in minutes", () => {
    expect(formatTimeUntilStart(1)).toBe("Empieza en 1 minuto");
    expect(formatTimeUntilStart(25)).toBe("Empieza en 25 minutos");
    expect(formatTimeUntilStart(59)).toBe("Empieza en 59 minutos");
  });

  it("switches to hours at the hour, and keeps the remainder", () => {
    expect(formatTimeUntilStart(60)).toBe("Empieza en 1 hora");
    expect(formatTimeUntilStart(120)).toBe("Empieza en 2 horas");
    expect(formatTimeUntilStart(700)).toBe("Empieza en 11 horas y 40 minutos");
    expect(formatTimeUntilStart(61)).toBe("Empieza en 1 hora y 1 minuto");
  });

  it("never counts down from zero or below — that state is 'En curso'", () => {
    expect(formatTimeUntilStart(0)).toBe("Empieza ahora");
    expect(formatTimeUntilStart(-5)).toBe("Empieza ahora");
  });
});

// ---------------------------------------------------------------------------
// One vocabulary for "N of a state".
//
// The nouns already existed here, private, spelling the bar's `aria-label`.
// Every OTHER surface wrote its own — the hover breakdown and the history
// table both printed a count against a singular label ("9 Presente", "0
// Tardanza"), which is the "regla de las palabras" broken in the one place the
// interface counts out loud.
// ---------------------------------------------------------------------------

describe("formatStateCount", () => {
  it("agrees the noun with the count", () => {
    expect(formatStateCount("present", 9)).toBe("9 presentes");
    expect(formatStateCount("present", 1)).toBe("1 presente");
    expect(formatStateCount("late", 1)).toBe("1 tardanza");
    expect(formatStateCount("justified", 0)).toBe("0 justificados");
    expect(formatStateCount("absent", 2)).toBe("2 ausentes");
  });

  it("spells the same nouns the bar's accessible name already used", () => {
    const counts = { present: 9, late: 1, justified: 0, absent: 2 };
    const label = buildSessionBarAriaLabel(counts, 12);
    for (const estado of ["present", "late", "justified", "absent"] as const) {
      expect(label).toContain(formatStateCount(estado, counts[estado]));
    }
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

// ---------------------------------------------------------------------------
// The pulse row's two derived figures
//
// `/trainer` grew the admin panel's StatCard row, and a tile is only worth
// drawing if the number behind it is READ rather than invented — the rule
// /profile's own history spells out twice. Both of these come from data the
// screen already holds.
// ---------------------------------------------------------------------------

describe("sumEnrolledToday", () => {
  it("adds up the enrolments across every session the club runs today", () => {
    const today = [schedule(1, "15:00", "16:00"), schedule(2, "18:00", "20:00")];

    expect(sumEnrolledToday(today, { 1: 7, 2: 12 })).toBe(19);
  });

  it("is zero — not unknown — on a day with no sessions at all", () => {
    expect(sumEnrolledToday([], {})).toBe(0);
    expect(sumEnrolledToday([], { 1: 7 })).toBe(0);
  });

  it("refuses a partial sum: one missing session makes the whole figure unknown", () => {
    // The roster call is a garnish and is allowed to fail. Adding up only the
    // sessions that did arrive would not be a smaller number, it would be a
    // WRONG one — and it would render as confidently as a right one.
    const today = [schedule(1, "15:00", "16:00"), schedule(2, "18:00", "20:00")];

    expect(sumEnrolledToday(today, { 1: 7 })).toBeNull();
    expect(sumEnrolledToday(today, {})).toBeNull();
  });
});

describe("buildMonthAttendanceRate", () => {
  const stats = (present: number, total: number, late = 0): AttendanceDayStats => ({
    totalPresent: present,
    totalAbsent: total - present - late,
    totalLate: late,
    totalJustified: 0,
    totalUnknown: 0,
    totalStudents: total,
  });

  // Issue #313 (K5, hallazgo #57): "vino a entrenar" incluye a quien llegó
  // tarde. El tile decía "presentes sobre el total" y subdeclaraba la
  // asistencia real en 16 puntos frente a la propia tabla de distribución de
  // la misma pantalla (Presente 207, Tardanza 46 sobre 346 -> 60% vs 73%).
  it("reads the rate as quienes entrenaron — presentes MAS tardanzas — sobre el total", () => {
    expect(buildMonthAttendanceRate(stats(207, 346, 46))).toEqual({
      percent: 73,
      present: 253,
      total: 346,
    });
  });

  it("returns zero instead of NaN for a month with no records", () => {
    expect(buildMonthAttendanceRate(stats(0, 0))).toEqual({
      percent: 0,
      present: 0,
      total: 0,
    });
  });

  it("rounds to a whole percent", () => {
    expect(buildMonthAttendanceRate(stats(1, 3)).percent).toBe(33);
    expect(buildMonthAttendanceRate(stats(2, 3)).percent).toBe(67);
  });
});

// ---------------------------------------------------------------------------
// The day rail (issue #211 successor: the hero band spends WIDTH, not height)
//
// Geometry only. Every number below is a CSS percentage of the rail's own
// window, never a displayed figure, so nothing here rounds.
// ---------------------------------------------------------------------------

/** A clock time on the fixture's day — the rail only ever reads hours/minutes. */
function at(hours: number, minutes: number): Date {
  return new Date(2026, 6, 23, hours, minutes);
}

describe("formatMinutesAsHora", () => {
  it("pads both halves so the rail's two scale labels are the same width", () => {
    expect(formatMinutesAsHora(0)).toBe("00:00");
    expect(formatMinutesAsHora(9 * 60 + 5)).toBe("09:05");
    expect(formatMinutesAsHora(15 * 60)).toBe("15:00");
    expect(formatMinutesAsHora(23 * 60 + 59)).toBe("23:59");
  });
});

describe("buildDayRail", () => {
  it("is null when there is nothing to draw", () => {
    expect(buildDayRail([], NOW)).toBeNull();
  });

  it("gives a lone session the whole rail — one full-width row, not a rail at all", () => {
    const rail = buildDayRail([schedule(1, "15:00", "16:00")], NOW);

    expect(rail).not.toBeNull();
    expect(rail?.lanes).toBe(1);
    expect(rail?.blocks).toHaveLength(1);
    expect(rail?.blocks[0]).toMatchObject({ leftPercent: 0, widthPercent: 100, lane: 0 });
    expect(rail?.startHora).toBe("15:00");
    expect(rail?.endHora).toBe("16:00");
  });

  it("sizes every block by its own duration and places it by its own hour", () => {
    // Window 15:00–20:00 is 300 minutes, so an hour is 20% and a half-hour 10%.
    const rail = buildDayRail(
      [
        schedule(1, "15:00", "16:00"),
        schedule(2, "17:00", "17:30"),
        schedule(3, "19:00", "20:00"),
      ],
      NOW,
    );

    expect(rail?.blocks.map((b) => [b.schedule.id, b.leftPercent, b.widthPercent])).toEqual([
      [1, 0, 20],
      [2, 40, 10],
      [3, 80, 20],
    ]);
    expect(rail?.startHora).toBe("15:00");
    expect(rail?.endHora).toBe("20:00");
  });

  it("orders blocks by hour whatever order the API sent them in", () => {
    const rail = buildDayRail(
      [schedule(3, "19:00", "20:00"), schedule(1, "15:00", "16:00"), schedule(2, "17:00", "17:30")],
      NOW,
    );

    expect(rail?.blocks.map((b) => b.schedule.id)).toEqual([1, 2, 3]);
  });

  it("phases each block against the clock: done, running, still to come", () => {
    const rail = buildDayRail(
      [
        schedule(1, "15:00", "16:00"),
        schedule(2, "17:00", "18:00"),
        schedule(3, "19:00", "20:00"),
      ],
      at(17, 20),
    );

    expect(rail?.blocks.map((b) => b.phase)).toEqual(["past", "live", "upcoming"]);
  });

  it("counts a block as past only once it has ENDED, not once the next one is nearer", () => {
    // 16:00 sharp: the 15:00 session is over, the 16:00 one has begun.
    const rail = buildDayRail(
      [schedule(1, "15:00", "16:00"), schedule(2, "16:00", "17:00")],
      at(16, 0),
    );

    expect(rail?.blocks.map((b) => b.phase)).toEqual(["past", "live"]);
  });

  it("stacks overlapping sessions into rows instead of drawing them on top of each other", () => {
    // The club runs two categories at once — `fetchTrainingSchedules` returns
    // every horario of the day, not one trainer's.
    const rail = buildDayRail(
      [
        schedule(1, "15:00", "16:00"),
        schedule(2, "15:00", "16:00"),
        schedule(3, "15:30", "16:30"),
        schedule(4, "17:00", "18:00"),
      ],
      NOW,
    );

    expect(rail?.lanes).toBe(3);
    expect(rail?.blocks.map((b) => [b.schedule.id, b.lane])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      // 17:00 clears every one of them, so it falls back to the first row.
      [4, 0],
    ]);
  });

  it("keeps a single row when sessions only touch end-to-start", () => {
    const rail = buildDayRail(
      [schedule(1, "15:00", "16:00"), schedule(2, "16:00", "17:00")],
      NOW,
    );

    expect(rail?.lanes).toBe(1);
    expect(rail?.blocks.every((b) => b.lane === 0)).toBe(true);
  });

  it("draws a session that crosses midday like any other — minutes, not clock faces", () => {
    // 11:30–13:00 straddles 720 minutes past midnight; nothing about the
    // window's arithmetic may notice.
    const rail = buildDayRail(
      [schedule(1, "11:30", "13:00"), schedule(2, "13:30", "14:30")],
      at(12, 0),
    );

    expect(rail?.startHora).toBe("11:30");
    expect(rail?.endHora).toBe("14:30");
    // Window is 180 minutes: 90 of them is half the rail. The thirds are left
    // unrounded on purpose — these are CSS widths, not figures anyone reads.
    expect(rail?.blocks[0].leftPercent).toBe(0);
    expect(rail?.blocks[0].widthPercent).toBe(50);
    expect(rail?.blocks[1].leftPercent).toBeCloseTo(66.667, 3);
    expect(rail?.blocks[1].widthPercent).toBeCloseTo(33.333, 3);
    expect(rail?.blocks[0].phase).toBe("live");
    expect(rail?.nowPercent).toBeCloseTo(16.667, 3);
  });

  it("puts the marker where the clock is, at either end included", () => {
    const day = [schedule(1, "15:00", "16:00"), schedule(2, "19:00", "20:00")];

    expect(buildDayRail(day, at(15, 0))?.nowPercent).toBe(0);
    expect(buildDayRail(day, at(17, 30))?.nowPercent).toBe(50);
    expect(buildDayRail(day, at(20, 0))?.nowPercent).toBe(100);
  });

  it("hides the marker before the day's first session — it is not standing at 15:00 yet", () => {
    // 03:20 on a day that starts at 15:00. Pinning the marker to the left edge
    // would say the first session is starting; the rail says nothing instead.
    const rail = buildDayRail([schedule(1, "15:00", "16:00"), schedule(2, "19:00", "20:00")], at(3, 20));

    expect(rail?.nowPercent).toBeNull();
    expect(rail?.blocks.every((b) => b.phase === "upcoming")).toBe(true);
  });

  it("hides the marker once the day's last session is over", () => {
    const rail = buildDayRail([schedule(1, "15:00", "16:00"), schedule(2, "19:00", "20:00")], at(21, 0));

    expect(rail?.nowPercent).toBeNull();
    expect(rail?.blocks.every((b) => b.phase === "past")).toBe(true);
  });

  it("drops a row it cannot draw instead of blanking the whole rail", () => {
    // `horaInicio` arrives as a string from the API, and a session that ends
    // before it starts has no width — neither may cost the day its rail.
    const rail = buildDayRail(
      [
        schedule(1, "15:00", "16:00"),
        schedule(2, "no es una hora", "17:00"),
        schedule(3, "18:00", "17:00"),
      ],
      NOW,
    );

    expect(rail?.blocks.map((b) => b.schedule.id)).toEqual([1]);
  });

  it("is null when not one session of the day can be drawn", () => {
    expect(buildDayRail([schedule(1, "??", "??")], NOW)).toBeNull();
  });
});
