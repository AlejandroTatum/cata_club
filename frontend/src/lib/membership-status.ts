/**
 * Shared membership-status mapping, safe to import from both server-only
 * code (`lib/server/**`) and client components. Kept separate from
 * `lib/server/payments-adapter.ts` (which re-exports it for backward
 * compatibility) so no `"use client"` file has to reach into `lib/server/`.
 */
import type { MembershipStatus } from "@/services/api";

export type BackendEstadoMembresia = "INACTIVA" | "ACTIVA" | "VENCIDA" | "SUSPENDIDA";

// PaymentValidationRequest.currentMembershipStatus has no "inactiva" value.
// INACTIVA (membership created, never had an approved payment) reads
// closest to "vencida" (needs a payment to become current).
//
// SUSPENDIDA (issue #935, backend since #400) keeps its own status here —
// it does not accumulate debt while it lasts, so folding it into "vencida"
// would misdescribe a membership that owes nothing.
export const MEMBERSHIP_STATUS_BY_ESTADO: Record<BackendEstadoMembresia, MembershipStatus> = {
  ACTIVA: "activa",
  VENCIDA: "vencida",
  INACTIVA: "vencida",
  SUSPENDIDA: "suspendida",
};

/**
 * Whether a backend estado is one of the TWO this module folds into the
 * single `"vencida"` bucket above (issue #713).
 *
 * The map is many-to-one, and that is the whole reason this predicate has to
 * exist. Anything that PRODUCES data for a row must ask the same question the
 * screen asks when it READS that row — and the screen only ever sees
 * `"vencida"`, never the backend enum. Hardcoding `estado === "VENCIDA"` on
 * the producing side silently excludes INACTIVA, so every "membership created
 * but never paid" row reached the admin as a `"vencida"` the producer had
 * skipped: the Pagos dialog then reported "Estado de deuda no disponible" for
 * 29 of the 45 memberships it showed as vencidas, while
 * `GET /membresias/{id}/deuda` answered `200 {"mesesAdeudados":0}` for every
 * one of them. Derived from the map rather than written out as a second list,
 * so a fourth estado cannot be added to the bucket and forgotten here.
 */
export function readsAsVencida(estado: BackendEstadoMembresia): boolean {
  return MEMBERSHIP_STATUS_BY_ESTADO[estado] === "vencida";
}
