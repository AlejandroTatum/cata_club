/**
 * Unit tests for the student portal's pure helpers — no React dependencies.
 */

import { describe, it, expect } from "vitest";
import {
  derivePortalMode,
  isRepresentative,
  isMinor,
  describeRanking,
  describeMembershipState,
  breakdownAttendance,
  daysUntil,
  formatLevelName,
  parseLevelNumber,
  personInitials,
  summarizeRecentAttendance,
  resolveCoverageEnd,
  describePaymentSituation,
  buildWeeklyTrainingSchedule,
  findNextTrainingSessions,
  COVERAGE_ENDING_SOON_DAYS,
} from "../student-utils";
import type { PaymentSituationInput } from "../student-utils";
import type { PagoPersona, StudentRankingSummary, StudentSessionSummary } from "@/services/api";

// ---------------------------------------------------------------------------
// derivePortalMode / isRepresentative
// ---------------------------------------------------------------------------

describe("derivePortalMode", () => {
  it('returns "pending" when there is no ALUMNO role and no representados', () => {
    expect(derivePortalMode(false, 0)).toBe("pending");
  });

  it('returns "active" when there is an ALUMNO role, even with no representados', () => {
    expect(derivePortalMode(true, 0)).toBe("active");
  });

  it('returns "active" when there are representados, even with no ALUMNO role', () => {
    expect(derivePortalMode(false, 2)).toBe("active");
  });

  it('returns "active" when both an ALUMNO role and representados are present', () => {
    expect(derivePortalMode(true, 1)).toBe("active");
  });
});

describe("isRepresentative", () => {
  it("is false with zero representados", () => {
    expect(isRepresentative(0)).toBe(false);
  });

  it("is true with one or more representados", () => {
    expect(isRepresentative(1)).toBe(true);
    expect(isRepresentative(3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isMinor
// ---------------------------------------------------------------------------

describe("isMinor", () => {
  it("returns true for a birth date younger than 18", () => {
    const today = new Date();
    const birthYear = today.getFullYear() - 15;
    expect(isMinor(`${birthYear}-06-15`)).toBe(true);
  });

  it("returns false for a birth date 18 or older", () => {
    const today = new Date();
    const birthYear = today.getFullYear() - 20;
    expect(isMinor(`${birthYear}-06-15`)).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isMinor(null)).toBe(false);
    expect(isMinor(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isMinor("")).toBe(false);
  });

  it("returns false for invalid date format", () => {
    expect(isMinor("not-a-date")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describeRanking
// ---------------------------------------------------------------------------

describe("describeRanking", () => {
  it("describes an unavailable/forbidden ranking", () => {
    const ranking: StudentRankingSummary = { status: "unavailable", reason: "forbidden" };
    const result = describeRanking(ranking);
    expect(result.label).toBe("No disponible");
    expect(result.tone).toBe("warn");
  });

  it("describes an unavailable/error ranking", () => {
    const ranking: StudentRankingSummary = { status: "unavailable", reason: "error" };
    expect(describeRanking(ranking).label).toBe("No disponible");
  });

  it("describes an available ranking with no nivel assigned yet", () => {
    const ranking: StudentRankingSummary = {
      status: "available",
      nivelNombre: null,
      estaEnRanking: false,
    };
    const result = describeRanking(ranking);
    expect(result.label).toBe("Sin nivel asignado");
    expect(result.tone).toBe("warn");
  });

  it("describes an active ranking without exposing position/points (removed — frozen data, no writer since cerrar_mes() removal)", () => {
    const ranking: StudentRankingSummary = {
      status: "available",
      nivelNombre: "Intermedios",
      estaEnRanking: true,
    };
    const result = describeRanking(ranking);
    expect(result.label).toBe("Intermedios");
    expect(result.detail).toBe("Activo en este nivel.");
    expect(result.detail).not.toMatch(/Posición|pts/);
    expect(result.tone).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// parseLevelNumber — the carnet's level chip
// ---------------------------------------------------------------------------

describe("parseLevelNumber", () => {
  it("reads the rung out of the backend's level name", () => {
    expect(parseLevelNumber("Nivel 9")).toBe(9);
    expect(parseLevelNumber("nivel 1")).toBe(1);
    expect(parseLevelNumber("10")).toBe(10);
  });

  it("returns null when there is no name at all", () => {
    expect(parseLevelNumber(null)).toBeNull();
    expect(parseLevelNumber("   ")).toBeNull();
  });

  it("returns null for a named level with no rung number — the chip must not invent one", () => {
    expect(parseLevelNumber("Intermedios")).toBeNull();
  });

  it("returns null for a rung outside the 1–10 ladder", () => {
    expect(parseLevelNumber("Nivel 0")).toBeNull();
    expect(parseLevelNumber("Nivel 11")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// personInitials — the avatar disc
// ---------------------------------------------------------------------------

describe("personInitials", () => {
  it("takes the first letter of the first given name and the first surname", () => {
    expect(personInitials("Ana Maria", "Garcia Lopez")).toBe("AG");
  });

  it("falls back to the given name alone when there is no surname", () => {
    expect(personInitials("Ana", "")).toBe("A");
  });

  it("returns an empty string when there is no name at all", () => {
    expect(personInitials("", "")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// summarizeRecentAttendance — the one real fact on the training panel
// ---------------------------------------------------------------------------

function session(estado: StudentSessionSummary["estado"], fecha: string): StudentSessionSummary {
  return { fecha, horario: "Lunes 15:00 — 16:00", estado };
}

describe("summarizeRecentAttendance", () => {
  it("returns null with no recorded sessions — there is no fact to state", () => {
    expect(summarizeRecentAttendance([])).toBeNull();
  });

  it("counts present and late as attended, absent and justified as missed", () => {
    const result = summarizeRecentAttendance([
      session("present", "2026-07-20"),
      session("late", "2026-07-18"),
      session("absent", "2026-07-15"),
      session("justified", "2026-07-13"),
    ]);
    expect(result).toEqual({ attended: 2, total: 4 });
  });

  it("reports a perfect record", () => {
    expect(summarizeRecentAttendance([session("present", "2026-07-20")])).toEqual({
      attended: 1,
      total: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveCoverageEnd
// ---------------------------------------------------------------------------

function pago(overrides: Partial<PagoPersona>): PagoPersona {
  return {
    id: 1,
    monto: "25.00",
    motivoRechazo: null,
    estadoPago: "PENDIENTE_VALIDACION",
    tipoPago: "TRANSFERENCIA",
    fechaRegistro: "2026-07-01T09:00:00Z",
    fechaValidacion: null,
    fechaInicio: "2026-07-01",
    fechaFin: "2026-07-31",
    personaId: 9,
    membresiaId: 3,
    voucherUrl: null,
    voucherFormato: null,
    ...overrides,
  };
}

describe("resolveCoverageEnd", () => {
  it("returns the furthest fechaFin among approved payments", () => {
    expect(
      resolveCoverageEnd([
        pago({ id: 1, estadoPago: "APROBADO", fechaFin: "2026-07-31" }),
        pago({ id: 2, estadoPago: "APROBADO", fechaFin: "2026-08-31" }),
      ]),
    ).toBe("2026-08-31");
  });

  it("ignores payments that are not approved — a pending one covers nothing yet", () => {
    expect(
      resolveCoverageEnd([
        pago({ id: 1, estadoPago: "APROBADO", fechaFin: "2026-07-31" }),
        pago({ id: 2, estadoPago: "PENDIENTE_VALIDACION", fechaFin: "2026-09-30" }),
        pago({ id: 3, estadoPago: "RECHAZADO", fechaFin: "2026-10-31" }),
      ]),
    ).toBe("2026-07-31");
  });

  it("returns null when nothing has been approved", () => {
    expect(resolveCoverageEnd([pago({ estadoPago: "PENDIENTE_VALIDACION" })])).toBeNull();
    expect(resolveCoverageEnd([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatLevelName
// ---------------------------------------------------------------------------

describe("formatLevelName", () => {
  it("names a bare rung number, so it does not read as a count", () => {
    // The seed data stores one level as "3" and another as "Nivel 9"; printed
    // raw beside a student's name, a lone "3" is not recognisable as a rank.
    expect(formatLevelName("3")).toBe("Nivel 3");
  });

  it("leaves an already-named level alone", () => {
    expect(formatLevelName("Nivel 9")).toBe("Nivel 9");
  });

  it("keeps a free-text level name verbatim rather than guessing a rung", () => {
    expect(formatLevelName("1B")).toBe("1B");
    expect(formatLevelName("Intermedios")).toBe("Intermedios");
  });

  it("returns null when there is no level to name", () => {
    expect(formatLevelName(null)).toBeNull();
    expect(formatLevelName("   ")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// daysUntil
// ---------------------------------------------------------------------------

describe("daysUntil", () => {
  const today = new Date(2026, 6, 25); // 25 jul 2026, local

  it("counts the whole days left before a future date", () => {
    expect(daysUntil("2026-07-28", today)).toBe(3);
  });

  it("returns 0 on the day coverage ends, not -1", () => {
    // Both ends are compared at local midnight; comparing timestamps would
    // make a same-day expiry read as already past from 00:01 onwards.
    expect(daysUntil("2026-07-25", today)).toBe(0);
  });

  it("goes negative once the date is past", () => {
    expect(daysUntil("2026-07-20", today)).toBe(-5);
  });

  it("crosses a DST-free month boundary without drifting", () => {
    expect(daysUntil("2026-08-25", today)).toBe(31);
  });

  it("tolerates a full timestamp, not just a date-only string", () => {
    expect(daysUntil("2026-07-28T18:30:00", today)).toBe(3);
  });

  it("returns null for a missing or unparseable date", () => {
    expect(daysUntil(null, today)).toBeNull();
    expect(daysUntil("", today)).toBeNull();
    expect(daysUntil("pronto", today)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// describeMembershipState
// ---------------------------------------------------------------------------

describe("describeMembershipState", () => {
  it("reads an ACTIVA membership as active", () => {
    expect(describeMembershipState("ACTIVA")).toEqual({
      label: "Membresía activa",
      tone: "ok",
      active: true,
    });
  });

  it("reads an INACTIVA membership as pending, never as failed", () => {
    // A membership the club has not activated yet is waiting, not broken —
    // `bad` here would tell a parent something is wrong when nothing is.
    expect(describeMembershipState("INACTIVA")).toEqual({
      label: "Membresía pendiente",
      tone: "warn",
      active: false,
    });
  });

  it("reads a VENCIDA membership as expired", () => {
    expect(describeMembershipState("VENCIDA")).toEqual({
      label: "Membresía vencida",
      tone: "bad",
      active: false,
    });
  });

  it("reads the absence of a membership as neutral, not as a failure", () => {
    expect(describeMembershipState(null)).toEqual({
      label: "Sin membresía",
      tone: "neutral",
      active: false,
    });
  });

  it("falls back to 'vencida' for any other estado the backend may add", () => {
    // Same fallback the carnet has always used — an unknown estado is never
    // reported as active.
    expect(describeMembershipState("SUSPENDIDA").active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// breakdownAttendance
// ---------------------------------------------------------------------------

describe("breakdownAttendance", () => {
  it("counts each of the four states separately", () => {
    expect(
      breakdownAttendance([
        session("present", "2026-07-20"),
        session("present", "2026-07-19"),
        session("late", "2026-07-18"),
        session("justified", "2026-07-17"),
        session("absent", "2026-07-16"),
      ]),
    ).toEqual({ present: 2, late: 1, justified: 1, absent: 1, total: 5 });
  });

  it("returns an all-zero breakdown for an empty history rather than null", () => {
    // The caller renders the tally beside a "no records yet" empty state, so
    // a zeroed object keeps that branch free of null checks.
    expect(breakdownAttendance([])).toEqual({
      present: 0,
      late: 0,
      justified: 0,
      absent: 0,
      total: 0,
    });
  });

  it("counts an unknown estado in the total without inventing a category for it", () => {
    const unknown = { fecha: "2026-07-15", horario: "Lunes 15:00 — 16:00", estado: "cancelled" };
    expect(
      breakdownAttendance([session("present", "2026-07-20"), unknown as StudentSessionSummary]),
    ).toEqual({ present: 1, late: 0, justified: 0, absent: 0, total: 2 });
  });
});

// ---------------------------------------------------------------------------
// describePaymentSituation
//
// The reader's three questions, answered from the payload alone: do I owe
// anything, how much, and what do I do about it. There is no debt concept in
// the backend, so "how much" can only ever be the plan's monthly price — these
// tests exist mostly to keep a balance from being invented later.
// ---------------------------------------------------------------------------

const TODAY = new Date(2026, 6, 25); // 25/07/2026, local midnight.

function situation(overrides: Partial<PaymentSituationInput> = {}): PaymentSituationInput {
  return {
    studentName: "Ana",
    viewingOwnProfile: true,
    blockedAsMinor: false,
    representanteName: null,
    hasMembership: true,
    planName: "Mensual Infantil",
    monthlyPrice: "25.00",
    coverageEnd: "2026-08-30",
    pendingCount: 0,
    ...overrides,
  };
}

describe("describePaymentSituation", () => {
  it("never claims a balance, an amount due or a due date in any state", () => {
    // The one permitted use of the word "saldo" is the sentence that DENIES
    // one, so the guard looks for the affirmative forms a fabricated debt
    // would take.
    const inputs: PaymentSituationInput[] = [
      situation(),
      situation({ coverageEnd: null }),
      situation({ coverageEnd: "2026-07-01" }),
      situation({ coverageEnd: "2026-07-28" }),
      situation({ pendingCount: 2 }),
      situation({ hasMembership: false, monthlyPrice: null, planName: null }),
      situation({ blockedAsMinor: true }),
    ];
    for (const input of inputs) {
      const result = describePaymentSituation(input, TODAY);
      const prose = `${result.headline} ${result.detail} ${result.priceNote ?? ""}`;
      expect(prose).not.toMatch(
        /saldo de|saldo pendiente de|adeud|deuda|debe pagar|total a pagar|vence el|fecha límite/i,
      );
    }
  });

  it("reports days of coverage left and stays quiet when there is plenty", () => {
    const result = describePaymentSituation(situation({ coverageEnd: "2026-08-30" }), TODAY);
    expect(result.kind).toBe("covered");
    expect(result.figure).toEqual({ value: 36, unit: "días de cobertura" });
    expect(result.urgent).toBe(false);
    expect(result.canRegister).toBe(true);
    expect(result.detail).toContain("30/08/2026");
  });

  it("asks for action once coverage is inside the last week", () => {
    const result = describePaymentSituation(situation({ coverageEnd: "2026-07-28" }), TODAY);
    expect(result.kind).toBe("ending-soon");
    expect(result.figure).toEqual({ value: 3, unit: "días de cobertura" });
    expect(result.headline).toBe("Le quedan 3 días de cobertura");
    expect(result.urgent).toBe(true);
  });

  it("uses the singular for the last day and drops the figure on the final day", () => {
    expect(describePaymentSituation(situation({ coverageEnd: "2026-07-26" }), TODAY).figure).toEqual(
      { value: 1, unit: "día de cobertura" },
    );
    const today = describePaymentSituation(situation({ coverageEnd: "2026-07-25" }), TODAY);
    expect(today.figure).toBeNull();
    expect(today.headline).toBe("Su cobertura termina hoy");
    expect(today.urgent).toBe(true);
  });

  it("counts the days since coverage ran out rather than the days that are left", () => {
    const result = describePaymentSituation(situation({ coverageEnd: "2026-07-20" }), TODAY);
    expect(result.kind).toBe("expired");
    expect(result.figure).toEqual({ value: 5, unit: "días vencida" });
    expect(result.headline).toBe("Su cobertura venció");
    expect(result.urgent).toBe(true);
    expect(result.canRegister).toBe(true);
  });

  it("says plainly that nothing has been approved instead of implying coverage", () => {
    const result = describePaymentSituation(situation({ coverageEnd: null }), TODAY);
    expect(result.kind).toBe("never-paid");
    expect(result.figure).toBeNull();
    expect(result.headline).toBe("No tiene ningún pago aprobado");
    expect(result.detail).toMatch(/no lleva un saldo pendiente/i);
    expect(result.urgent).toBe(true);
    expect(result.canRegister).toBe(true);
  });

  it("names the dependent when the reader is the guardian, and keeps usted for their own profile", () => {
    const guardian = describePaymentSituation(
      situation({ studentName: "Sofía", viewingOwnProfile: false, coverageEnd: "2026-07-28" }),
      TODAY,
    );
    expect(guardian.headline).toBe("A Sofía le quedan 3 días de cobertura");

    const own = describePaymentSituation(situation({ coverageEnd: "2026-07-28" }), TODAY);
    expect(own.headline).toBe("Le quedan 3 días de cobertura");
  });

  it("hands a pending payment back to the club instead of asking for another one", () => {
    const result = describePaymentSituation(
      situation({ pendingCount: 1, coverageEnd: "2026-07-20" }),
      TODAY,
    );
    expect(result.kind).toBe("awaiting-validation");
    expect(result.figure).toEqual({ value: 1, unit: "pago en revisión" });
    expect(result.canRegister).toBe(false);
    expect(result.urgent).toBe(false);
  });

  it("does not offer to register a payment when the club has not created a membership", () => {
    const result = describePaymentSituation(
      situation({ hasMembership: false, monthlyPrice: null, planName: null, coverageEnd: null }),
      TODAY,
    );
    expect(result.kind).toBe("no-membership");
    expect(result.canRegister).toBe(false);
    expect(result.priceNote).toBeNull();
    expect(result.detail).toMatch(/administración/i);
  });

  it("sends a minor to the representative the backend actually has on record", () => {
    const result = describePaymentSituation(
      situation({ blockedAsMinor: true, representanteName: "Laura Vera" }),
      TODAY,
    );
    expect(result.kind).toBe("minor-blocked");
    expect(result.canRegister).toBe(false);
    expect(result.detail).toContain("Laura Vera");
  });

  it("sends a minor with no representative on record to the club, never to a person who does not exist", () => {
    const result = describePaymentSituation(situation({ blockedAsMinor: true }), TODAY);
    expect(result.kind).toBe("minor-blocked");
    expect(result.detail).not.toMatch(/su representante/i);
    expect(result.detail).toMatch(/administración del club/i);
  });

  it("states the monthly price as a price, never as an amount owed", () => {
    const result = describePaymentSituation(situation(), TODAY);
    expect(result.priceNote).toBe("Plan Mensual Infantil · $25,00 al mes");
  });

  it("drops the plan name when the backend has none but keeps the price it can prove", () => {
    expect(describePaymentSituation(situation({ planName: null }), TODAY).priceNote).toBe(
      "$25,00 al mes",
    );
    expect(describePaymentSituation(situation({ monthlyPrice: null }), TODAY).priceNote).toBeNull();
  });

  it("treats a coverage date it cannot parse as no coverage rather than as NaN days", () => {
    const result = describePaymentSituation(situation({ coverageEnd: "no-es-una-fecha" }), TODAY);
    expect(result.figure).toBeNull();
    expect(result.headline).not.toMatch(/NaN/);
  });

  it("keeps the ending-soon window at exactly one week", () => {
    expect(COVERAGE_ENDING_SOON_DAYS).toBe(7);
    expect(describePaymentSituation(situation({ coverageEnd: "2026-08-01" }), TODAY).kind).toBe(
      "ending-soon",
    );
    expect(describePaymentSituation(situation({ coverageEnd: "2026-08-02" }), TODAY).kind).toBe(
      "covered",
    );
  });
});

// ---------------------------------------------------------------------------
// The weekly training schedule
//
// The one place the portal is allowed to state a FUTURE session from. The
// rows are `AlumnoHorario` — the assignment an admin makes in `/groups` — so
// nothing here is projected off the membership's `franjaHoraria`, which is a
// time range with no weekday in it.
// ---------------------------------------------------------------------------

function asignacion(horarioDia: string, horarioHoraInicio: string, horarioHoraFin: string) {
  return { horarioDia, horarioHoraInicio, horarioHoraFin };
}

describe("buildWeeklyTrainingSchedule", () => {
  it("merges the club's consecutive one-hour blocks into the window the student attends", () => {
    // Exactly what the seed creates for a "Mensual Infantil" child: three
    // adjacent Horario rows per day, one per categoría.
    const slots = buildWeeklyTrainingSchedule([
      asignacion("LUNES", "15:00:00", "16:00:00"),
      asignacion("LUNES", "16:00:00", "17:00:00"),
      asignacion("LUNES", "17:00:00", "18:00:00"),
    ]);

    expect(slots).toEqual([
      { dia: "LUNES", diaLabel: "Lunes", horaInicio: "15:00", horaFin: "18:00" },
    ]);
  });

  it("keeps two windows separate when the day genuinely has a gap between them", () => {
    const slots = buildWeeklyTrainingSchedule([
      asignacion("SABADO", "18:00:00", "20:00:00"),
      asignacion("SABADO", "09:00:00", "11:00:00"),
    ]);

    expect(slots.map((slot) => `${slot.horaInicio}-${slot.horaFin}`)).toEqual([
      "09:00-11:00",
      "18:00-20:00",
    ]);
  });

  it("orders the week from Monday, whatever order the backend sent", () => {
    const slots = buildWeeklyTrainingSchedule([
      asignacion("SABADO", "18:00:00", "20:00:00"),
      asignacion("MARTES", "15:00:00", "16:00:00"),
      asignacion("LUNES", "15:00:00", "16:00:00"),
    ]);

    expect(slots.map((slot) => slot.dia)).toEqual(["LUNES", "MARTES", "SABADO"]);
  });

  it("drops a row it cannot read rather than rendering 'undefined' on a family's screen", () => {
    const slots = buildWeeklyTrainingSchedule([
      asignacion("FUNESDAY", "15:00:00", "16:00:00"),
      asignacion("LUNES", "no-es-una-hora", "16:00:00"),
      // An end at or before the start is not a session.
      asignacion("LUNES", "16:00:00", "16:00:00"),
      asignacion("LUNES", "15:00:00", "16:00:00"),
    ]);

    expect(slots).toEqual([
      { dia: "LUNES", diaLabel: "Lunes", horaInicio: "15:00", horaFin: "16:00" },
    ]);
  });

  it("returns nothing at all when the club has assigned nothing", () => {
    expect(buildWeeklyTrainingSchedule([])).toEqual([]);
  });
});

describe("findNextTrainingSessions", () => {
  const SCHEDULE = buildWeeklyTrainingSchedule([
    asignacion("LUNES", "15:00:00", "18:00:00"),
    asignacion("MIERCOLES", "15:00:00", "18:00:00"),
    asignacion("VIERNES", "15:00:00", "18:00:00"),
  ]);

  /** 2026-07-22 is a Wednesday. Noon-anchored, so no zone shifts the calendar day. */
  const WEDNESDAY_MORNING = new Date("2026-07-22T09:00:00-05:00");

  it("walks the calendar forward from today, soonest first", () => {
    const next = findNextTrainingSessions(SCHEDULE, 3, WEDNESDAY_MORNING);

    expect(next.map((session) => session.fecha)).toEqual([
      "2026-07-22",
      "2026-07-24",
      "2026-07-27",
    ]);
    expect(next[0].diaLabel).toBe("Miércoles");
  });

  it("calls today's session 'hoy' only while its window is still open", () => {
    const morning = findNextTrainingSessions(SCHEDULE, 1, WEDNESDAY_MORNING);
    expect(morning[0].isToday).toBe(true);

    // 21:00 — the 15:00-18:00 window closed three hours ago, so the next
    // Wednesday session is next Wednesday's, and saying "hoy" would be the
    // one reading a parent could act on and be wrong about.
    const night = findNextTrainingSessions(SCHEDULE, 3, new Date("2026-07-22T21:00:00-05:00"));
    expect(night.some((session) => session.isToday)).toBe(false);
    expect(night[0].fecha).toBe("2026-07-24");
    expect(night.map((session) => session.fecha)).toContain("2026-07-29");
  });

  it("sorts same-day windows by their start time", () => {
    const twice = buildWeeklyTrainingSchedule([
      asignacion("MIERCOLES", "18:00:00", "20:00:00"),
      asignacion("MIERCOLES", "09:00:00", "11:00:00"),
    ]);

    expect(findNextTrainingSessions(twice, 2, WEDNESDAY_MORNING).map((s) => s.horaInicio)).toEqual([
      "09:00",
      "18:00",
    ]);
  });

  it("returns nothing when there is no schedule to walk", () => {
    expect(findNextTrainingSessions([], 3, WEDNESDAY_MORNING)).toEqual([]);
  });
});
