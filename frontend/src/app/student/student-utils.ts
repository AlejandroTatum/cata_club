/**
 * Pure utility functions for the Student portal page.
 *
 * Extracted from page.tsx for testability — no React dependencies. Follows
 * the same pattern as attendance-utils.ts / members-utils.ts.
 */

import type {
  MembershipSummary,
  PagoPersona,
  StudentRankingSummary,
  StudentSessionSummary,
} from "@/services/api";

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

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * The monthly fee actually applied to this persona's membership, as a decimal
 * string — `Membresia.monto_aplicado`, reached through `/membresias/mias`.
 * `null` means the amount cannot be resolved, and the UI must then offer the
 * action with no figure attached rather than print a plausible one.
 */
export function resolveMonthlyAmount(membership: MembershipSummary | null): string | null {
  return membership?.montoAplicado ?? null;
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

/**
 * The payment a comprobante can still be attached to — anything not yet
 * approved and not yet carrying a voucher, including a REJECTED one (whose
 * whole point is that the student must upload a legible replacement).
 */
export function findUploadablePago(pagos: PagoPersona[]): PagoPersona | null {
  return pagos.find((pago) => pago.estadoPago !== "APROBADO" && !pago.voucherUrl) ?? null;
}
