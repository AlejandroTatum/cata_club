/**
 * Pure utility functions for the Student portal page.
 *
 * Extracted from page.tsx for testability — no React dependencies. Follows
 * the same pattern as attendance-utils.ts / members-utils.ts.
 */

import type { StudentRankingSummary } from "@/services/api";

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
