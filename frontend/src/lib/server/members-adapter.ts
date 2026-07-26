/**
 * Translates FastAPI's `/personas`, `/membresias/pagos*`, `/membresias/*`
 * and `/ranking/niveles*` DTOs (camelCase, see backend
 * app/presentacion/schemas/persona_schemas.py, membresia_pago_schemas.py,
 * ranking_schemas.py) into the `MemberAccount[]` shape
 * src/app/members/page.tsx already renders — server-only, used by
 * src/app/api/members/route.ts. Mirrors src/lib/server/payments-adapter.ts
 * and attendance-adapter.ts.
 *
 * Domain mapping (per the Fase 4 plan): a `MemberAccount` is a root Persona
 * (`representanteId === null`). Personas that point to it via
 * `representanteId` become its `estudiantes` (role "representante");
 * otherwise the root manages only itself (role "estudiante", self-managed).
 * Derived locally from one paginated `/personas/` fetch instead of N calls
 * to `/personas/{id}/representados` — same avoid-N+1 tradeoff already
 * documented in attendance-adapter.ts's `fetchPersonaNameMap`.
 *
 * Known backend gaps found while building this (new — not the
 * horario/nivel-ranking link gap already documented in
 * attendance-adapter.ts):
 *
 *  1. `PersonaResponseDTO` carries no `roles` field, and there is no bulk
 *     "roles by persona" endpoint (only `POST`/`DELETE
 *     /personas/{id}/roles`, which mutate — nothing to `GET`). A
 *     staff-only Persona (ADMINISTRADOR/ENTRENADOR/REPRESENTANTE with no
 *     student profile) is therefore indistinguishable, via this API, from
 *     a self-managed "estudiante" account that simply has no membership
 *     yet — both surface here as a root account with one empty-membership
 *     student. Left as-is rather than guessing a heuristic (e.g. "has an
 *     AntecedentesClub record") that isn't backed by any documented
 *     contract.
 *  2. `PersonaResponseDTO` has no `email` — email lives on `Usuario`
 *     (login credentials), not every Persona has one (a managed child may
 *     have no login), and there's no bulk lookup. `MemberAccount.email`/
 *     `MemberStudentSummary.email` are optional and simply omitted here.
 *  3. No endpoint exposes a readable account active/inactive flag (only
 *     `PATCH /personas/{id}/cuenta/estado`, write-only). `activo` defaults
 *     to `true` for every student built here.
 *  4. No endpoint lists `Membresia`/`Pago` by `persona_id` directly — this
 *     reuses the admin payment queue (`GET /membresias/pagos`, the same
 *     endpoint payments-adapter.ts consumes) and takes each persona's most
 *     recent payment as their current membership signal.
 */

import type { EstadoMembresia } from "@/types/domain";
import type { MemberAccount, MemberStudentSummary, PaymentStatus } from "@/app/members/members-utils";
import { MEMBERSHIP_STATUS_BY_ESTADO, type BackendEstadoPago, type BackendMembresia, type BackendTipoMembresia } from "@/lib/server/payments-adapter";
import type { BackendPagoListItem } from "@/lib/server/payments-adapter";

// ---------------------------------------------------------------------------
// Backend DTO shapes (camelCase, as received from FastAPI)
// ---------------------------------------------------------------------------

/** Fields of `PersonaResponseDTO` this feature needs. */
export interface BackendPersonaFull {
  id: number;
  nombres: string;
  apellidos: string;
  telefono: string;
  fechaNacimiento: string;
  representanteId: number | null;
}

// ---------------------------------------------------------------------------
// Enum maps
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_BY_ESTADO_PAGO: Record<BackendEstadoPago, PaymentStatus> = {
  APROBADO: "aprobado",
  PENDIENTE_VALIDACION: "pendiente_validacion",
  RECHAZADO: "rechazado",
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildMembershipTypeLabel(tipo: BackendTipoMembresia | undefined): string {
  return tipo ? `${tipo.categoria} (${tipo.franjaHoraria})` : "Sin tipo";
}

function buildMemberStudentSummary(
  persona: BackendPersonaFull,
  pago: BackendPagoListItem | undefined,
  membresiaById: Map<number, BackendMembresia>,
  membresiaByPersona: Map<number, BackendMembresia>,
  tipoById: Map<number, BackendTipoMembresia>,
  nivelId: number | undefined,
): MemberStudentSummary {
  /*
   * A membership does not require a payment to exist. Three personas in the
   * current data hold an ACTIVA membresía with zero Pago rows — Ana García is
   * one — and resolving membership ONLY through the latest payment made this
   * screen show them as having none, while their own student portal said
   * "Membresía activa". So the payment chain is the primary source (it also
   * supplies the paid period), and `membresiaByPersona` is the fallback.
   */
  const membresia =
    (pago ? membresiaById.get(pago.membresiaId) : undefined) ?? membresiaByPersona.get(persona.id);
  const tipo = membresia ? tipoById.get(membresia.tipoMembresiaId) : undefined;

  return {
    id: String(persona.id),
    nombres: persona.nombres,
    apellidos: persona.apellidos,
    telefono: persona.telefono,
    grupoId: nivelId !== undefined ? String(nivelId) : null,
    fechaNacimiento: persona.fechaNacimiento,
    activo: true, // gap #3 above — no readable account-active flag exists via any GET endpoint
    membresia: membresia
      ? {
          id: membresia.id,
          tipo: buildMembershipTypeLabel(tipo),
          estado: MEMBERSHIP_STATUS_BY_ESTADO[membresia.estado] as EstadoMembresia,
          // No pago, no paid period: empty strings, which
          // `formatMembershipPeriod` already renders as nothing rather than as
          // an invented range.
          fechaInicio: pago?.fechaInicio ?? "",
          fechaFin: pago?.fechaFin ?? "",
          monto: Number(pago?.monto ?? membresia.montoAplicado ?? 0),
        }
      : null,
    ultimoPago: pago
      ? {
          estado: PAYMENT_STATUS_BY_ESTADO_PAGO[pago.estadoPago],
          fechaPago: pago.fechaRegistro,
          monto: Number(pago.monto),
          periodo: `${pago.fechaInicio} — ${pago.fechaFin}`,
        }
      : null,
  };
}

/**
 * Build the `MemberAccount[]` list from the raw backend collections. Pure —
 * no fetching (that happens in the route handler, same split as
 * payments-adapter.ts).
 *
 * @param personas — every Persona (`GET /personas/`).
 * @param latestPagoByPersona — each persona's most recent Pago, keyed by `personaId`.
 * @param membresiaById — `Membresia` lookups keyed by `membresiaId`.
 * @param membresiaByPersona — fallback `Membresia` for personas with no Pago, keyed by `personaId`.
 * @param tipoById — `TipoMembresia` catalog keyed by `tipoMembresiaId`.
 * @param nivelIdByPersona — current `NivelRanking` (Grupo) id, keyed by `personaId`.
 */
export function buildMemberAccounts(
  personas: BackendPersonaFull[],
  latestPagoByPersona: Map<number, BackendPagoListItem>,
  membresiaById: Map<number, BackendMembresia>,
  membresiaByPersona: Map<number, BackendMembresia>,
  tipoById: Map<number, BackendTipoMembresia>,
  nivelIdByPersona: Map<number, number>,
): MemberAccount[] {
  const childrenByRepresentante = new Map<number, BackendPersonaFull[]>();
  for (const persona of personas) {
    if (persona.representanteId !== null) {
      const list = childrenByRepresentante.get(persona.representanteId) ?? [];
      list.push(persona);
      childrenByRepresentante.set(persona.representanteId, list);
    }
  }

  const roots = personas.filter((persona) => persona.representanteId === null);

  return roots.map((root) => {
    const children = childrenByRepresentante.get(root.id) ?? [];
    const estudiantesSource = children.length > 0 ? children : [root];

    // All root personas are adults (minors always have representanteId set),
    // and self-enrollment now assigns the REPRESENTANTE role to every adult
    // self-enrollee. Without a bulk roles endpoint (gap #1 in the module
    // docstring), we label every root as "representante" — the admin edit
    // modal already shows/toggles the actual backend roles.
    return {
      id: String(root.id),
      role: "representante" as const,
      nombres: root.nombres,
      apellidos: root.apellidos,
      telefono: root.telefono,
      estudiantes: estudiantesSource.map((persona) =>
        buildMemberStudentSummary(
          persona,
          latestPagoByPersona.get(persona.id),
          membresiaById,
          membresiaByPersona,
          tipoById,
          nivelIdByPersona.get(persona.id),
        ),
      ),
    };
  });
}
