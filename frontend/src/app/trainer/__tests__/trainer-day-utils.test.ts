import { describe, it, expect } from "vitest";
import type { AttendanceRecord, TrainingSchedule } from "@/app/attendance/attendance-utils";
import {
  ABSENCE_ALERT_THRESHOLD,
  buildAbsenceNotice,
  findAbsenceAlert,
  formatAbsenceCount,
  formatEnrolledCount,
  formatSessionCountdown,
  groupRecordsBySession,
  minutesSinceMidnight,
  minutesUntilStart,
  monthToDateRange,
  parseHoraToMinutes,
  selectTodaySessions,
  summarizeLastSession,
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
    entrenadorId: 1,
    entrenadorNombre: "Coach Torres",
    nivelRankingId: null,
  };
}

function record(
  partial: Partial<AttendanceRecord> & Pick<AttendanceRecord, "estado">,
): AttendanceRecord {
  return {
    id: partial.id ?? Math.random().toString(36),
    fecha: partial.fecha ?? "2026-07-23",
    horario: partial.horario ?? "Lunes 15:00 — 16:00",
    personaId: partial.personaId ?? 1,
    estudiante: partial.estudiante ?? "Ana López",
    entrenador: partial.entrenador ?? "Coach Torres",
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

describe("formatSessionCountdown", () => {
  it.each([
    [25, "En 25 minutos"],
    [1, "En 1 minuto"],
    [59, "En 59 minutos"],
    [60, "En 1 hora"],
    [90, "En 1 hora y 30 min"],
    [137, "En 2 horas y 17 min"],
    [120, "En 2 horas"],
  ])("formats %i minutes as %s", (minutes, expected) => {
    expect(formatSessionCountdown(minutes)).toBe(expected);
  });

  it("says the session is running instead of counting backwards", () => {
    expect(formatSessionCountdown(0)).toBe("En curso");
    expect(formatSessionCountdown(-12)).toBe("En curso");
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
    expect(sessions[0].registradoPor).toBe("Coach Torres");
  });

  it("separates two horarios on the same day", () => {
    const sessions = groupRecordsBySession([
      record({ estado: "present", horario: "Lunes 15:00 — 16:00" }),
      record({ estado: "absent", horario: "Lunes 17:00 — 18:00" }),
    ]);

    expect(sessions).toHaveLength(2);
    // Later horario first — most recent session at the top.
    expect(sessions[0].horario).toBe("Lunes 17:00 — 18:00");
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

describe("summarizeLastSession", () => {
  it("returns the most recent session", () => {
    const summary = summarizeLastSession([
      record({ estado: "present", fecha: "2026-07-20" }),
      record({ estado: "absent", fecha: "2026-07-23" }),
    ]);

    expect(summary?.fecha).toBe("2026-07-23");
    expect(summary?.counts.absent).toBe(1);
  });

  it("returns null when nothing has been filed", () => {
    expect(summarizeLastSession([])).toBeNull();
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

describe("buildAbsenceNotice", () => {
  it("names the student and the count in the message sent to the club", () => {
    expect(buildAbsenceNotice({ estudiante: "Luis Lopez", ausencias: 3 })).toBe(
      "Hola, quiero avisar que Luis Lopez suma 3 ausencias este mes.",
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
