/**
 * Pure utility functions for the Student portal page.
 *
 * Extracted from page.tsx for testability — no React dependencies. Follows
 * the same pattern as attendance-utils.ts / members-utils.ts.
 */

import type {
  AlumnoHorario,
  MembershipSummary,
  PagoPersona,
  StudentRankingSummary,
  StudentSessionSummary,
} from "@/services/api";
import { CLUB_TIME_ZONE, calendarIsoDate, clubToday } from "@/lib/club-date";

const MAJORITY_AGE = 18;

// ---------------------------------------------------------------------------
// Age gate
// ---------------------------------------------------------------------------

/**
 * True when the persona is younger than 18 as of today. Uses the same
 * component-wise calculation as `enroll-utils.ts::calculateAge` (avoids
 * UTC midnight shifts in Ecuador timezone). Returns `false` for
 * invalid/empty dates so the portal does not accidentally restrict access.
 */
export function isMinor(fechaNacimiento: string | null | undefined): boolean {
  if (!fechaNacimiento) return false;
  const parts = fechaNacimiento.split("-");
  if (parts.length !== 3) return false;
  const [y, m, d] = parts.map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() - (m - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) age--;
  return age < MAJORITY_AGE;
}

// ---------------------------------------------------------------------------
// Portal mode
// ---------------------------------------------------------------------------

/**
 * The honest intermediate state for an authenticated persona with no
 * recognized backend role (`UserRole === "unsupported"`, see
 * src/lib/server/auth.ts's `mapBackendRoleToUserRole`).
 *
 * Role assignment for ALUMNO is lazy (see backend
 * `rol_servicio.py::asignar_alumno_si_corresponde`'s docstring: granted only
 * once a Membresia is created, not at account creation) — so a freshly
 * self-enrolled persona genuinely has zero roles until someone (an admin,
 * today) creates their membership. `"pending"` names that state explicitly
 * instead of routing through the generic /unauthorized page. A persona who
 * has already added a dependent (representados.length > 0) is NOT pending —
 * they're an active representante account, even without an ALUMNO role of
 * their own.
 */
export type StudentPortalMode = "pending" | "active";

export function derivePortalMode(hasAlumnoRole: boolean, representadosCount: number): StudentPortalMode {
  return !hasAlumnoRole && representadosCount === 0 ? "pending" : "active";
}

/** True when the account manages one or more dependents — independent of whether it also has its own ALUMNO profile. */
export function isRepresentative(representadosCount: number): boolean {
  return representadosCount > 0;
}

import type { BadgeTone } from "@/components/ui/Badge";

// ---------------------------------------------------------------------------
// Ranking display
// ---------------------------------------------------------------------------

export interface RankingDisplay {
  label: string;
  detail: string;
  /** `Badge` tone, not a class string — colour lives in the primitive. */
  tone: BadgeTone;
}

/**
 * Human-readable label + badge class for a `StudentRankingSummary` — one
 * place to keep the three states (available/in-ranking, available/
 * not-yet-ranked, unavailable) consistent.
 *
 * No longer shows "Posición #X · Y pts": the backend stopped exposing
 * `posicionActual`/`puntajeAcumulado` because they were frozen forever (no
 * writer since `cerrar_mes()` was removed) — showing a frozen number as if
 * it were live was the actual reliability bug this addresses. See
 * apply-progress of `limpieza-asistencia-y-nivel-entrenador` slice E.
 */
export function describeRanking(ranking: StudentRankingSummary): RankingDisplay {
  if (ranking.status === "unavailable") {
    return ranking.reason === "forbidden"
      ? { label: "No disponible", detail: "Solo el propio alumno puede ver este perfil.", tone: "warn" }
      : { label: "No disponible", detail: "No se pudo consultar el ranking en este momento.", tone: "warn" };
  }
  if (!ranking.estaEnRanking) {
    return { label: "Sin nivel asignado", detail: "Aún no fue asignado a un nivel de ranking.", tone: "warn" };
  }
  return {
    label: ranking.nivelNombre ?? "Nivel sin nombre",
    detail: "Activo en este nivel.",
    tone: "ok",
  };
}

// ---------------------------------------------------------------------------
// Carnet — the membership card
//
// Every field the club card shows must come from the portal payload. Three
// fields the approved prototype (`docs/ux/prototipos/22-alumno-cuenta.html`)
// draws have no source and are therefore NOT rendered:
//
//   - "Miembro nº" — no member-number concept exists anywhere in the backend
//     (`PersonaResponseDTO` carries a surrogate `id`, which is not an
//     externally-meaningful membership number).
//   - "Desde"      — `MembresiaResponseDTO.fecha_activacion` exists backend-side
//     but is dropped by `BackendMembresiaPropia`/`MembershipView` in
//     src/lib/server/student-adapter.ts, so it never reaches this client.
//   - "Renueva"    — no renewal date exists on a Membresia at all. The card
//     shows "Cobertura hasta" instead, derived from the furthest `fechaFin`
//     among the persona's APPROVED payments, which is a real coverage end.
// ---------------------------------------------------------------------------

/**
 * The rung number behind a backend level name, or `null` when it cannot be
 * read as one of the ten ladder rungs.
 *
 * `NivelRanking.nombre` is free text: the seed data uses "Nivel 9", but an
 * admin may rename a level to "Intermedios". Only a real 1–10 rung earns the
 * `LevelChip`; anything else falls back to the plain name, never a guessed
 * number.
 */
export function parseLevelNumber(nivelNombre: string | null): number | null {
  if (!nivelNombre) return null;
  const match = /(\d{1,2})\s*$/.exec(nivelNombre.trim());
  if (!match) return null;
  const rung = Number(match[1]);
  return Number.isInteger(rung) && rung >= 1 && rung <= 10 ? rung : null;
}

/**
 * A level name with the word "Nivel" in front of it when the backend name is a
 * bare rung number.
 *
 * `NivelRanking.nombre` is free text and the seed data uses both conventions:
 * "Nivel 9" in one place and a bare "3" in another. Printed raw next to a
 * student's name — as the dependants list on /profile does — a lone "3" reads
 * as a count of something, not as a rank.
 */
export function formatLevelName(nivelNombre: string | null | undefined): string | null {
  if (!nivelNombre) return null;
  const name = nivelNombre.trim();
  if (!name) return null;
  const rung = parseLevelNumber(name);
  return rung !== null ? `Nivel ${rung}` : name;
}

/**
 * First given name — "Sofía", not "Sofía Alejandra".
 *
 * Every family screen addresses a dependent by their first name, so the four
 * of them share one reading of what that is.
 */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

/** First letter of the first given name plus first letter of the first surname — the avatar disc. */
export function personInitials(nombres: string, apellidos: string): string {
  const first = nombres.trim().split(/\s+/)[0]?.[0] ?? "";
  const last = apellidos.trim().split(/\s+/)[0]?.[0] ?? "";
  return `${first}${last}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Next-training panel
// ---------------------------------------------------------------------------

export interface AttendanceRecap {
  attended: number;
  total: number;
}

/**
 * How many of the persona's recorded sessions they actually turned up to.
 *
 * The scope is deliberately "las últimas N sesiones registradas", NOT "este
 * mes": `buildRecentSessions` in src/lib/server/student-adapter.ts caps the
 * payload at the five most recent records, so a month-scoped figure cannot be
 * computed here without inventing the denominator.
 *
 * `late` counts as attended — the student came. `justified` does not: it is an
 * excused absence, and counting it would overstate the figure a parent reads.
 */
export function summarizeRecentAttendance(
  sessions: StudentSessionSummary[],
): AttendanceRecap | null {
  if (sessions.length === 0) return null;
  const attended = sessions.filter((s) => s.estado === "present" || s.estado === "late").length;
  return { attended, total: sessions.length };
}

/**
 * How the persona's recorded sessions split across the four attendance states.
 *
 * `summarizeRecentAttendance` answers "did they come?"; this answers "what
 * happened", which is the question `/student/attendance` exists to show. The
 * two are kept apart on purpose: collapsing `justified` into `absent` in the
 * ratio is correct (an excused absence is still an absence), but collapsing it
 * in the breakdown would hide the one state a parent most wants to verify.
 *
 * `total` counts every record, including an `estado` this build does not know
 * about, so the four categories never silently add up to less than the list
 * the reader is looking at.
 */
export interface AttendanceBreakdown {
  present: number;
  late: number;
  justified: number;
  absent: number;
  total: number;
}

export function breakdownAttendance(sessions: StudentSessionSummary[]): AttendanceBreakdown {
  return {
    present: sessions.filter((s) => s.estado === "present").length,
    late: sessions.filter((s) => s.estado === "late").length,
    justified: sessions.filter((s) => s.estado === "justified").length,
    absent: sessions.filter((s) => s.estado === "absent").length,
    total: sessions.length,
  };
}

// ---------------------------------------------------------------------------
// The weekly training schedule — the one truthful source for "next session"
//
// `HorarioEntrenamiento` on its own carries no link to the persona it serves
// (see the doc comment on src/lib/server/attendance-adapter.ts), which is why
// the portal used to print the most recent RECORDED session under the heading
// "Entrenamientos" — a past fact labelled as if it were the next one.
//
// `AlumnoHorario` DOES carry that link: it is the assignment an admin makes in
// `/groups`, and `GET /asistencias/alumnos/{id}/horarios` returns exactly the
// slots one student is enrolled in. So what the panel shows is not a
// projection: it is the recurring weekly schedule the club assigned, and the
// dates are the next calendar occurrences of it.
//
// ## What it still cannot say
//
// The club has no per-date session record ahead of time — no cancellations, no
// holidays, no one-off changes exist anywhere in the backend. So the panel
// names its own source out loud ("el horario semanal que el club le asignó")
// rather than presenting a date as a scheduled, confirmed event.
// ---------------------------------------------------------------------------

/** Backend `DiaSemana` → the Spanish label the rest of the app already uses. */
const DIA_LABELS: Record<string, string> = {
  LUNES: "Lunes",
  MARTES: "Martes",
  MIERCOLES: "Miércoles",
  JUEVES: "Jueves",
  VIERNES: "Viernes",
  SABADO: "Sábado",
  DOMINGO: "Domingo",
};

/** Backend `DiaSemana` → `Date.getDay()`, so day arithmetic needs no lookup table of its own. */
const DIA_JS_DAY: Record<string, number> = {
  DOMINGO: 0,
  LUNES: 1,
  MARTES: 2,
  MIERCOLES: 3,
  JUEVES: 4,
  VIERNES: 5,
  SABADO: 6,
};

const WEEK_ORDER = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"];

/** One weekday's continuous training window — "Lunes 15:00 — 18:00". */
export interface WeeklyTrainingSlot {
  /** Backend weekday key, `"LUNES"` … `"DOMINGO"`. */
  dia: string;
  /** The Spanish label for `dia`. */
  diaLabel: string;
  /** `HH:MM`. */
  horaInicio: string;
  /** `HH:MM`. */
  horaFin: string;
}

/** A `WeeklyTrainingSlot` plus the calendar date of its next occurrence. */
export interface UpcomingTraining extends WeeklyTrainingSlot {
  /** `YYYY-MM-DD` — the next date this slot falls on. */
  fecha: string;
  /** True when that date is today and the window has not closed yet. */
  isToday: boolean;
}

/** `"15:00:00"` → `"15:00"`, or `null` when the backend sent something that is not a time. */
function toHourMinute(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${match[1]}:${match[2]}`;
}

/** `"15:30"` → 930. Only ever called on a value `toHourMinute` already accepted. */
function minutesOf(hourMinute: string): number {
  return Number(hourMinute.slice(0, 2)) * 60 + Number(hourMinute.slice(3, 5));
}

/**
 * Minutes since midnight AT THE CLUB, so "has today's session already ended"
 * is not answered with the reader's device clock in another timezone.
 *
 * Falls back to the device reading rather than throwing inside a render — the
 * cost of being wrong is one extra session shown as "hoy", not a crash.
 */
function clubMinutesOfDay(now: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CLUB_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hours = Number(parts.find((part) => part.type === "hour")?.value);
    const minutes = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
      return now.getHours() * 60 + now.getMinutes();
    }
    // `hour12: false` reports midnight as "24" in some ICU builds.
    return (hours % 24) * 60 + minutes;
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

/**
 * The student's real weekly schedule, one entry per continuous window.
 *
 * The club models a three-hour afternoon as three consecutive one-hour
 * `Horario` rows (FORMATIVO 15–16, INFANTIL 16–17, JUVENIL 17–18) and assigns a
 * student to all three, which is why the seed hands one child fifteen
 * assignments for five days. Listing them raw would tell a parent their
 * daughter has three sessions on Monday; adjacent windows are therefore merged
 * into the one block she actually attends — the same 15:00-18:00 her
 * membership's `franjaHoraria` states.
 *
 * Rows whose weekday or times the backend sent in a shape this build does not
 * recognise are dropped rather than rendered as "undefined".
 */
export function buildWeeklyTrainingSchedule(
  rows: Pick<AlumnoHorario, "horarioDia" | "horarioHoraInicio" | "horarioHoraFin">[],
): WeeklyTrainingSlot[] {
  const byDia = new Map<string, { start: string; end: string }[]>();

  for (const row of rows) {
    const dia = row.horarioDia?.toUpperCase();
    if (!dia || !(dia in DIA_JS_DAY)) continue;
    const start = toHourMinute(row.horarioHoraInicio);
    const end = toHourMinute(row.horarioHoraFin);
    if (start === null || end === null || minutesOf(end) <= minutesOf(start)) continue;
    const list = byDia.get(dia) ?? [];
    list.push({ start, end });
    byDia.set(dia, list);
  }

  const slots: WeeklyTrainingSlot[] = [];
  for (const dia of WEEK_ORDER) {
    const ranges = byDia.get(dia);
    if (!ranges) continue;
    ranges.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
    const merged: { start: string; end: string }[] = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      // `<=`, not `<`: 15:00-16:00 followed by 16:00-17:00 is one window, not
      // two sessions with no gap between them.
      if (last && minutesOf(range.start) <= minutesOf(last.end)) {
        if (minutesOf(range.end) > minutesOf(last.end)) last.end = range.end;
      } else {
        merged.push({ ...range });
      }
    }
    for (const range of merged) {
      slots.push({
        dia,
        diaLabel: DIA_LABELS[dia] ?? dia,
        horaInicio: range.start,
        horaFin: range.end,
      });
    }
  }
  return slots;
}

/**
 * The next `limit` occurrences of a weekly schedule, soonest first.
 *
 * A window whose day is today counts as today only while it is still open —
 * at 21:00 on a Monday the next Monday session is next Monday's, and saying
 * "hoy" would be the one reading a parent could act on and be wrong about.
 */
export function findNextTrainingSessions(
  slots: WeeklyTrainingSlot[],
  limit = 3,
  now: Date = new Date(),
): UpcomingTraining[] {
  const today = clubToday(now);
  const todayJsDay = today.getDay();
  const nowMinutes = clubMinutesOfDay(now);

  return slots
    .map((slot) => {
      const jsDay = DIA_JS_DAY[slot.dia];
      let daysAhead = (jsDay - todayJsDay + 7) % 7;
      const isToday = daysAhead === 0 && minutesOf(slot.horaFin) > nowMinutes;
      if (daysAhead === 0 && !isToday) daysAhead = 7;
      const date = new Date(today.getTime());
      date.setDate(date.getDate() + daysAhead);
      return { slot, daysAhead, isToday, fecha: calendarIsoDate(date) };
    })
    .sort((a, b) =>
      a.daysAhead !== b.daysAhead
        ? a.daysAhead - b.daysAhead
        : minutesOf(a.slot.horaInicio) - minutesOf(b.slot.horaInicio),
    )
    .slice(0, Math.max(0, limit))
    .map(({ slot, fecha, isToday }) => ({ ...slot, fecha, isToday }));
}

// ---------------------------------------------------------------------------
// Membership state
// ---------------------------------------------------------------------------

export interface MembershipState {
  label: string;
  tone: BadgeTone;
  /** True only for a membership the club has actually activated. */
  active: boolean;
}

/**
 * The single reading of a `Membresia.estado` for the family-facing screens.
 *
 * The carnet on `/student` and the status card on `/student/payments` used to
 * each spell their own version of this — one said "Membresía pendiente", the
 * other rendered the raw `INACTIVA` enum, and the payments one painted expiry
 * in red text on the page field. One function, so a parent reading the two
 * screens back to back never has to decide which of them is right.
 *
 * Anything the backend may add later falls through to "vencida", never to
 * "activa": over-reporting coverage is the one error that costs the family
 * money.
 */
export function describeMembershipState(estado: string | null | undefined): MembershipState {
  if (!estado) return { label: "Sin membresía", tone: "neutral", active: false };
  if (estado === "ACTIVA") return { label: "Membresía activa", tone: "ok", active: true };
  if (estado === "INACTIVA") return { label: "Membresía pendiente", tone: "warn", active: false };
  return { label: "Membresía vencida", tone: "bad", active: false };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------


/**
 * Whole days from today to an ISO `YYYY-MM-DD` date — negative once it is past.
 *
 * Not an estimate and not a projection: it is arithmetic on a date the club
 * already approved, and it is the reading a family actually wants from
 * "cobertura hasta el 28/07/2026". Both ends are compared at local midnight so
 * "today" is a calendar day, not a 24-hour window — a payment ending today
 * returns 0, never -1 because of the hour.
 *
 * Returns `null` for an unparseable date rather than a number that would be
 * rendered as "hace NaN días".
 */
export function daysUntil(isoDate: string | null | undefined, today: Date = new Date()): number | null {
  if (!isoDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return null;
  const target = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(target.getTime())) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

/** The furthest `fechaFin` among APPROVED payments — the real end of paid coverage, or `null` when nothing is approved yet. */
export function resolveCoverageEnd(pagos: PagoPersona[]): string | null {
  return pagos
    .filter((pago) => pago.estadoPago === "APROBADO")
    .reduce<string | null>(
      (furthest, pago) => (furthest === null || pago.fechaFin > furthest ? pago.fechaFin : furthest),
      null,
    );
}

// ---------------------------------------------------------------------------
// The payment situation — the one thing the family portal owes its reader
//
// The audit's second complaint ("no se indica bien cómo ir a hacer el pago,
// muy confuso") was not that the route was missing: `/student` linked to
// `/student/payments`, which carried a working form. It was that the portal
// never answered the three questions a family arrives with — do I owe
// anything, how much, and what do I do about it — and that the answer to the
// third was an underlined text link sitting below two secondary buttons that
// looked far more like the page's action than it did.
//
// This function is the single reading of that state. Every screen in the
// family area asks it the same question and gets the same answer, so the home
// screen and the payments screen can never again word the same `estado`
// differently.
//
// ## What it will never say
//
// There is NO debt concept anywhere in the backend. `Membresia.montoAplicado`
// is the plan's price, not a balance; no endpoint exposes an amount owed, a
// due date or a renewal date. So "how much" is answered with the monthly price
// and labelled as a price, and the absence of a balance is stated in as many
// words ("El club no lleva un saldo pendiente") rather than filled in with a
// plausible-looking number. `describePaymentSituation`'s test suite asserts
// that no branch ever emits "saldo", "adeuda", "debe" or "vence el".
// ---------------------------------------------------------------------------

import { formatCurrency, formatDate } from "@/lib/format-utils";

/**
 * How close to the end of paid coverage the portal starts asking for action.
 *
 * A week: long enough that a family paying by transfer has time for the club
 * to validate it before coverage lapses, short enough that the band is not
 * shouting at somebody who paid three weeks ago.
 */
export const COVERAGE_ENDING_SOON_DAYS = 7;

export type PaymentSituationKind =
  | "minor-blocked"
  | "no-membership"
  | "awaiting-validation"
  | "never-paid"
  | "expired"
  | "ending-soon"
  | "covered";

export interface PaymentSituationInput {
  /** The given name of the profile on screen — used only when the reader is a guardian. */
  studentName: string;
  /** True when the profile on screen belongs to the account holder themselves. */
  viewingOwnProfile: boolean;
  /** True only for a minor looking at their OWN account — a guardian paying for a minor is not blocked. */
  blockedAsMinor: boolean;
  /** The representative the backend has on record for a minor, or `null` when it has none. */
  representanteName: string | null;
  /** True when the club has created a `Membresia` for this profile. */
  hasMembership: boolean;
  /** `Membresia.categoria` — the plan's name, when it has one. */
  planName: string | null;
  /** `Membresia.montoAplicado` — the plan's MONTHLY PRICE. Never a balance. */
  monthlyPrice: string | null;
  /** The furthest `fechaFin` among APPROVED payments (`resolveCoverageEnd`). */
  coverageEnd: string | null;
  /** How many of this profile's payments are waiting on the club. */
  pendingCount: number;
}

export interface PaymentSituation {
  kind: PaymentSituationKind;
  /** The one real number this state leads with, or `null` when there is none to lead with. */
  figure: { value: number; unit: string } | null;
  /** What is true right now, in the words a family would use. */
  headline: string;
  /** The evidence behind the headline — always a date or a fact the club can prove. */
  detail: string;
  /** The plan's monthly price, stated as a price. `null` when the backend has none. */
  priceNote: string | null;
  /** True when the reader is the person who can register a payment from here. */
  canRegister: boolean;
  /** True when the state asks the reader to act now — the only thing that earns the red CTA. */
  urgent: boolean;
}

/** "A Sofía le quedan…" for a guardian, "Le quedan…" for the account holder. */
function possessivePrefix(input: PaymentSituationInput): string {
  return input.viewingOwnProfile ? "" : `A ${input.studentName} `;
}

/** "Sofía no tiene…" for a guardian, "No tiene…" for the account holder. */
function subjectPrefix(input: PaymentSituationInput): string {
  return input.viewingOwnProfile ? "" : `${input.studentName} `;
}

/** Upper-case the first letter, so the same clause can open a sentence or sit inside one. */
function sentence(clause: string): string {
  return clause.charAt(0).toUpperCase() + clause.slice(1);
}

/** "el último pago aprobado cubre hasta el 28/07/2026" — a clause, so it composes. */
function coverageClause(coverageEnd: string, past: boolean): string {
  return `el último pago aprobado ${past ? "cubrió" : "cubre"} hasta el ${formatDate(coverageEnd)}`;
}

/**
 * The plan price line — "Plan Mensual Infantil · $25,00 al mes".
 *
 * Deliberately not a sentence and deliberately not "Total a pagar": it is the
 * catalogue price of one month, and a family paying three months at once pays
 * three times it. The renewal form does that arithmetic where the reader can
 * see it; this line only states the unit.
 */
function describePrice(input: PaymentSituationInput): string | null {
  if (!input.monthlyPrice) return null;
  const price = `${formatCurrency(input.monthlyPrice)} al mes`;
  return input.planName ? `Plan ${input.planName} · ${price}` : price;
}

export function describePaymentSituation(
  input: PaymentSituationInput,
  today: Date = new Date(),
): PaymentSituation {
  const situation = resolveSituation(input, today);
  // A profile with approved payments but no `Membresia` row still gets its
  // coverage reported — the reading is real either way — but it cannot be
  // asked to renew something the club has not created, and there is nothing
  // urgent about a state the reader has no way to act on.
  if (!input.hasMembership && situation.kind !== "no-membership") {
    return {
      ...situation,
      detail: `${situation.detail} El club no tiene una membresía activa a este nombre: acérquese a administración para reactivarla.`,
      canRegister: false,
      urgent: false,
    };
  }
  return situation;
}

function resolveSituation(input: PaymentSituationInput, today: Date): PaymentSituation {
  const priceNote = describePrice(input);
  const daysLeft = daysUntil(input.coverageEnd, today);
  // An unparseable `fechaFin` is treated as no coverage at all rather than as
  // "hace NaN días" — over-reporting coverage is the one error that costs the
  // family money, and under-reporting it only costs them a second look.
  const coverageEnd = daysLeft === null ? null : input.coverageEnd;

  if (input.blockedAsMinor) {
    return {
      kind: "minor-blocked",
      figure:
        daysLeft !== null && daysLeft > 0
          ? { value: daysLeft, unit: daysLeft === 1 ? "día de cobertura" : "días de cobertura" }
          : null,
      headline: "Sus pagos los registra el club",
      // The old copy said "Lo hace su representante desde la suya" to EVERY
      // minor, including the ones whose `representanteId` is null — it named a
      // person who does not exist and left the reader with nowhere to go.
      detail: input.representanteName
        ? `Un estudiante menor de edad no registra pagos desde su propia cuenta: lo hace ${input.representanteName} desde la suya.`
        : "Un estudiante menor de edad no registra pagos desde su propia cuenta. Su cuenta no tiene un representante registrado, así que el pago se hace en administración del club.",
      priceNote,
      canRegister: false,
      urgent: false,
    };
  }

  // Only when the club has nothing on file at all. A profile that HAS approved
  // payments has a real coverage date to report, and printing "todavía no
  // tiene una membresía" over it would contradict the history below.
  if (!input.hasMembership && daysLeft === null) {
    return {
      kind: "no-membership",
      figure: null,
      headline: sentence(`${subjectPrefix(input)}todavía no tiene una membresía`),
      detail:
        "El club crea la membresía al registrar el primer pago. Acérquese a administración para activarla y después podrá renovarla desde aquí.",
      priceNote,
      canRegister: false,
      urgent: false,
    };
  }

  if (input.pendingCount > 0) {
    const one = input.pendingCount === 1;
    return {
      kind: "awaiting-validation",
      figure: { value: input.pendingCount, unit: one ? "pago en revisión" : "pagos en revisión" },
      headline: one
        ? `El club está validando ${input.viewingOwnProfile ? "su pago" : `el pago de ${input.studentName}`}`
        : `El club está validando ${input.pendingCount} pagos${input.viewingOwnProfile ? "" : ` de ${input.studentName}`}`,
      detail: coverageEnd
        ? `Mientras tanto, ${coverageClause(coverageEnd, (daysLeft ?? 0) < 0)}.`
        : "En cuanto lo apruebe, aquí aparecerá hasta qué fecha queda cubierto.",
      priceNote,
      // Not a permission problem: the backend accepts a second pending payment,
      // but the club then has two vouchers for one period to reconcile. The
      // renewal form has always refused it; the band now says why.
      canRegister: false,
      urgent: false,
    };
  }

  if (coverageEnd === null || daysLeft === null) {
    return {
      kind: "never-paid",
      figure: null,
      headline: sentence(`${subjectPrefix(input)}no tiene ningún pago aprobado`),
      detail:
        "El club no lleva un saldo pendiente: usted registra el pago del período que quiere cubrir y el club lo valida.",
      priceNote,
      canRegister: true,
      urgent: true,
    };
  }

  if (daysLeft < 0) {
    const overdue = Math.abs(daysLeft);
    return {
      kind: "expired",
      figure: { value: overdue, unit: overdue === 1 ? "día vencida" : "días vencida" },
      headline: input.viewingOwnProfile
        ? "Su cobertura venció"
        : `La cobertura de ${input.studentName} venció`,
      detail: sentence(`${coverageClause(coverageEnd, true)}.`),
      priceNote,
      canRegister: true,
      urgent: true,
    };
  }

  if (daysLeft <= COVERAGE_ENDING_SOON_DAYS) {
    return {
      kind: "ending-soon",
      // "0 días de cobertura" reads as "you have none"; the headline says the
      // truer thing, so the last day leads with words instead of a figure.
      figure:
        daysLeft === 0
          ? null
          : { value: daysLeft, unit: daysLeft === 1 ? "día de cobertura" : "días de cobertura" },
      headline:
        daysLeft === 0
          ? input.viewingOwnProfile
            ? "Su cobertura termina hoy"
            : `La cobertura de ${input.studentName} termina hoy`
          : sentence(
              `${possessivePrefix(input)}le ${
                daysLeft === 1 ? "queda 1 día" : `quedan ${daysLeft} días`
              } de cobertura`,
            ),
      detail: sentence(`${coverageClause(coverageEnd, false)}.`),
      priceNote,
      canRegister: true,
      urgent: true,
    };
  }

  return {
    kind: "covered",
    figure: { value: daysLeft, unit: "días de cobertura" },
    headline: input.viewingOwnProfile
      ? "Está al día con el club"
      : `${input.studentName} está al día con el club`,
    detail: sentence(`${coverageClause(coverageEnd, false)}.`),
    priceNote,
    canRegister: true,
    urgent: false,
  };
}

