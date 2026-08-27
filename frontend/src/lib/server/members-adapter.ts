/**
 * Translates FastAPI's `/personas`, `/membresias/pagos*` and `/membresias/*`
 * DTOs (camelCase, see backend app/presentacion/schemas/persona_schemas.py,
 * membresia_pago_schemas.py) into the `MemberAccount[]` shape
 * src/app/members/page.tsx already renders — server-only, used by
 * src/app/api/members/route.ts. Mirrors src/lib/server/payments-adapter.ts
 * and attendance-adapter.ts.
 *
 * Domain mapping (issue #388): a `MemberAccount` is ONE Persona, root or
 * represented — not a root with its represented personas nested inside it.
 * Every persona in the input gets its own row with its OWN membership/payment
 * status; a represented persona's row also carries `representadoPor` (its
 * representative's full name), read off `representanteId` via a
 * `personaById` lookup. This used to group by root and nest every represented
 * persona inside the root's `estudiantes[]`, which hid a represented person's
 * own status behind the group's best status (see `getAccountStatusBadge`) and
 * excluded a root WITH dependants from its own `estudiantes[]` entirely.
 * Derived locally from one paginated `/personas/` fetch instead of N calls
 * to `/personas/{id}/representados` — same avoid-N+1 tradeoff as
 * `payments-adapter.ts#buildRepresentanteNameMap`.
 *
 * Known backend gaps found while building this:
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
 *
 * Issue #362 closed a fifth gap: there was no bulk "who has a ficha médica"
 * signal, so `sinDatosEmergencia` (below) always read `false`. `GET
 * /fichas-medicas/existe` now answers that in one query — see
 * `personaIdsConFicha` below and `backend/app/presentacion/routers/ficha_medica_router.py`.
 */

import type { EstadoMembresia } from "@/types/domain";
import type { MemberAccount, MemberStudentSummary, PaymentStatus } from "@/app/members/members-utils";
import { MEMBERSHIP_STATUS_BY_ESTADO, type BackendEstadoPago, type BackendMembresia, type BackendTipoMembresia } from "@/lib/server/payments-adapter";
import { readsAsVencida } from "@/lib/membership-status";
import type { BackendPagoListItem } from "@/lib/server/payments-adapter";

// ---------------------------------------------------------------------------
// Backend DTO shapes (camelCase, as received from FastAPI)
// ---------------------------------------------------------------------------

/**
 * Issue #326: one row of `GET /membresias/deuda/bulk`'s response
 * (`DeudaMembresiaBulkItemDTO`, camelCase via `ResponseBase`) — resolved
 * server-side in `src/app/api/members/route.ts` and passed in here keyed by
 * `membresiaId`. Only `mesesAdeudados`/`montoMensual` are needed here — the
 * route keeps the raw `membresiaId`/`ultimaCoberturaFin` fields for its own
 * bookkeeping, this adapter only multiplies.
 */
export interface DeudaBulkItem {
  mesesAdeudados: number;
  montoMensual: number;
}

/** Fields of `PersonaResponseDTO` this feature needs. */
export interface BackendPersonaFull {
  id: number;
  nombres: string;
  apellidos: string;
  /**
   * National ID. `PersonaResponseDTO` declares it required and the column is
   * NOT NULL, so every real response carries one — but it is OPTIONAL here on
   * purpose. A consumer that treats it as guaranteed renders a blank where a
   * document number belongs the day a fixture, an older deployment or a
   * partial DTO omits it, and a credential with an empty field is worse than a
   * credential with one field fewer.
   */
  cedula?: string | null;
  telefono: string;
  fechaNacimiento: string;
  representanteId: number | null;
  /** Profile photo URL (Cloudinary). Absent/null until someone uploads one. */
  fotoUrl?: string | null;
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

// The plan's name alone. It used to read "Mensual Adultos (20:00-21:00)",
// pairing the plan with a hand-typed franja that drifted from the club's real
// hours; a membership type is a price, and the hours belong to the horarios
// the club assigns each student.
function buildMembershipTypeLabel(tipo: BackendTipoMembresia | undefined): string {
  return tipo ? tipo.categoria : "Sin tipo";
}

/**
 * Which `BackendMembresia` (if any) is displayed for a persona — the payment
 * chain first (also supplies the paid period), `membresiaByPersona` as
 * fallback for a membership with zero Pago rows. Exported so
 * `src/app/api/members/route.ts` can compute the exact set of VENCIDA
 * membresiaIds actually rendered (issue #326, the bulk debt lookup) without
 * duplicating this resolution rule — two independent implementations of
 * "which membership is this persona's" is exactly the kind of drift the
 * backend's `_fecha_fin_maxima_combinada` docstring warns about.
 *
 * A membership does not require a payment to exist. Three personas in the
 * current data hold an ACTIVA membresía with zero Pago rows — Ana García is
 * one — and resolving membership ONLY through the latest payment made this
 * screen show them as having none, while their own student portal said
 * "Membresía activa".
 */
export function resolveMembresiaParaPersona(
  personaId: number,
  pago: BackendPagoListItem | undefined,
  membresiaById: Map<number, BackendMembresia>,
  membresiaByPersona: Map<number, BackendMembresia>,
): BackendMembresia | undefined {
  return (pago ? membresiaById.get(pago.membresiaId) : undefined) ?? membresiaByPersona.get(personaId);
}

function buildMemberStudentSummary(
  persona: BackendPersonaFull,
  pago: BackendPagoListItem | undefined,
  membresiaById: Map<number, BackendMembresia>,
  membresiaByPersona: Map<number, BackendMembresia>,
  tipoById: Map<number, BackendTipoMembresia>,
  deudaByMembresiaId: Map<number, DeudaBulkItem>,
): MemberStudentSummary {
  const membresia = resolveMembresiaParaPersona(persona.id, pago, membresiaById, membresiaByPersona);
  const tipo = membresia ? tipoById.get(membresia.tipoMembresiaId) : undefined;

  /*
   * Issue #326: overdue amount + months, for the memberships the admin reads
   * as vencidas. The multiplication (`mesesAdeudados * montoMensual`) is pure
   * presentation arithmetic on two numbers the backend already computed — see
   * the module's DeudaBulkItem doc comment; the day-15/16 debt formula itself
   * never runs here. Omitted (not fabricated as zero) when the bulk lookup
   * didn't resolve this membresiaId — same degrade-gracefully convention as
   * `sinDatosEmergencia`'s ficha-médica lookup below.
   *
   * Issue #713: this predicate MUST stay the same one `route.ts` uses to
   * build the bulk query, and both must be `readsAsVencida` rather than
   * `=== "VENCIDA"` — `estado` is written out below through
   * `MEMBERSHIP_STATUS_BY_ESTADO`, which folds INACTIVA into `"vencida"` too.
   * Attaching on the narrow enum while EMITTING the wide bucket is what left
   * every never-paid membership reaching the dialog as a `"vencida"` with no
   * `mesesAdeudados`, which is precisely the "Estado de deuda no disponible"
   * the admin was shown for a debt the backend answers.
   */
  const deuda = membresia && readsAsVencida(membresia.estado)
    ? deudaByMembresiaId.get(membresia.id)
    : undefined;

  return {
    id: String(persona.id),
    nombres: persona.nombres,
    apellidos: persona.apellidos,
    // Issue #460: the admin panel had no way to link a minor to a
    // representative because it never carried the one value the existing
    // `vincular-representado` endpoint needs to identify WHICH persona to
    // link (its body takes a cédula, not a persona_id) — see
    // `LinkRepresentativeSection.tsx`. Same optional/omit convention as
    // `BackendPersonaFull.cedula` above: never fabricated when the backend
    // omits it.
    cedula: persona.cedula ?? undefined,
    telefono: persona.telefono,
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
          // Issue #313 (K5 hallazgo #44): SIEMPRE el precio del plan
          // (`montoAplicado`), nunca el monto del último pago. Antes este
          // campo tomaba `pago.monto` cuando había un pago, así que una
          // renovación de dos meses ($50) hacía que la ficha leyera "precio
          // de la membresía: $50" — el mismo importe que `ultimoPago.monto`,
          // duplicado con otro nombre. Son dos hechos distintos: cuánto
          // cuesta el plan por mes, y cuánto fue el último pago.
          monto: Number(membresia.montoAplicado ?? 0),
          // Normalized to a concrete boolean (never left `undefined`), even
          // though the field is optional on `BackendMembresia` — see that
          // interface's doc comment (payments-adapter.ts) for why an older
          // backend omitting it must resolve to "no gratuity" here.
          esGratuidadFamiliar: membresia.esGratuidadFamiliar ?? false,
          ...(deuda
            ? { mesesAdeudados: deuda.mesesAdeudados, montoAdeudado: deuda.mesesAdeudados * deuda.montoMensual }
            : {}),
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
 * One row per persona (issue #388) — not one row per root with its
 * represented personas nested inside. Each row's `estudiantes` is always a
 * single-element array holding that exact persona's own summary.
 *
 * @param personas — every Persona (`GET /personas/`).
 * @param latestPagoByPersona — each persona's most recent Pago, keyed by `personaId`.
 * @param membresiaById — `Membresia` lookups keyed by `membresiaId`.
 * @param membresiaByPersona — fallback `Membresia` for personas with no Pago, keyed by `personaId`.
 * @param tipoById — `TipoMembresia` catalog keyed by `tipoMembresiaId`.
 * @param personaIdsConFicha — issue #362: persona ids that HAVE a ficha
 *   médica, from `GET /fichas-medicas/existe`. Optional (defaults to an empty
 *   set) so existing fixtures/tests that don't care about the emergency-data
 *   gap don't need to thread it through — every row simply reads
 *   `sinDatosEmergencia: false` until it's supplied.
 * @param deudaByMembresiaId — issue #326: `GET /membresias/deuda/bulk`
 *   results keyed by `membresiaId`. Optional (defaults to an empty map) —
 *   only read for a VENCIDA membership, and only ever adds the two owed-debt
 *   fields, so omitting it changes nothing for existing callers/fixtures.
 */
export function buildMemberAccounts(
  personas: BackendPersonaFull[],
  latestPagoByPersona: Map<number, BackendPagoListItem>,
  membresiaById: Map<number, BackendMembresia>,
  membresiaByPersona: Map<number, BackendMembresia>,
  tipoById: Map<number, BackendTipoMembresia>,
  personaIdsConFicha: Set<number> = new Set(),
  deudaByMembresiaId: Map<number, DeudaBulkItem> = new Map(),
): MemberAccount[] {
  const personaById = new Map<number, BackendPersonaFull>(
    personas.map((persona) => [persona.id, persona]),
  );

  return personas.map((persona) => {
    const representante =
      persona.representanteId != null ? personaById.get(persona.representanteId) : undefined;

    // All root personas are adults (minors always have representanteId set),
    // and self-enrollment now assigns the REPRESENTANTE role to every adult
    // self-enrollee. Without a bulk roles endpoint (gap #1 in the module
    // docstring), we label every row as "representante" — the admin edit
    // modal already shows/toggles the actual backend roles. This is a
    // pre-existing, separately-tracked gap; not fixed here.
    return {
      id: String(persona.id),
      role: "representante" as const,
      nombres: persona.nombres,
      apellidos: persona.apellidos,
      telefono: persona.telefono,
      representadoPor: representante ? `${representante.nombres} ${representante.apellidos}` : undefined,
      // Issue #362's exact gap: no legal representative at all AND no ficha
      // médica. A represented persona (has `representanteId`) is NEVER in the
      // gap here, even with no ficha médica of their own — this deliberately
      // does not check the representative's own contact data (that's a wider
      // question `EmergencyCardDialog.tsx`'s `estaCompletamenteVacia` asks,
      // not this one).
      sinDatosEmergencia: persona.representanteId == null && !personaIdsConFicha.has(persona.id),
      estudiantes: [
        buildMemberStudentSummary(
          persona,
          latestPagoByPersona.get(persona.id),
          membresiaById,
          membresiaByPersona,
          tipoById,
          deudaByMembresiaId,
        ),
      ],
    };
  });
}
