/**
 * Translates FastAPI's `/membresias/pagos*` DTOs (camelCase, see backend
 * app/presentacion/schemas/membresia_pago_schemas.py) into the
 * `PaymentValidationRequest` shape `src/app/payments/page.tsx` already
 * consumes — server-only, used by the Route Handlers under
 * `src/app/api/payments/**`.
 *
 * `PagoListItemDTO` (the queue list) doesn't carry the membership's current
 * status or plan type — those live on `Membresia`/`TipoMembresia`, fetched
 * separately per row. Acceptable for an admin validation queue (small,
 * infrequent, not a hot path); revisit if the queue grows large enough for
 * N+1 to matter.
 */

import type { NextRequest } from "next/server";
import type { PaymentValidationRequest, ProofFileType, ValidationStatus } from "@/services/api";
import { MEMBERSHIP_STATUS_BY_ESTADO, type BackendEstadoMembresia } from "@/lib/membership-status";
import { ESTADO_PAGO_TO_VALIDATION_STATUS } from "@/lib/status-badges";
import { backendFetchAuthed } from "@/lib/server/backend-client";
import { formatDateRange } from "@/lib/format-utils";

export type BackendEstadoPago = "APROBADO" | "PENDIENTE_VALIDACION" | "RECHAZADO";
export type BackendTipoPago = "EFECTIVO" | "TRANSFERENCIA";

// Re-exported for backward compatibility — moved to lib/membership-status.ts
// so client components (e.g. src/app/profile/page.tsx) don't have to import
// from lib/server/**. `EstadoMembresia` (domain.ts) is the same 3-value
// union as `MembershipStatus`.
export { MEMBERSHIP_STATUS_BY_ESTADO, type BackendEstadoMembresia };

const PAYMENT_METHOD_BY_TIPO_PAGO: Record<BackendTipoPago, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
};

function proofFileType(voucherFormato?: string | null): ProofFileType {
  return voucherFormato?.toLowerCase().includes("pdf") ? "pdf" : "image";
}

function proofFileName(voucherUrl?: string | null): string {
  if (!voucherUrl) return "Sin comprobante adjunto";
  const lastSegment = voucherUrl.split("/").pop();
  return lastSegment || "Comprobante";
}

/** Fields common to both `PagoListItemDTO` and `PagoResponseDTO` (camelCase, as received from FastAPI). */
export interface BackendPagoCore {
  id: number;
  monto: string;
  estadoPago: BackendEstadoPago;
  tipoPago: BackendTipoPago;
  fechaRegistro: string;
  fechaValidacion?: string | null;
  fechaInicio: string;
  fechaFin: string;
  personaId: number;
  membresiaId: number;
  voucherUrl?: string | null;
  voucherFormato?: string | null;
  /**
   * Only present on `PagoResponseDTO` (the PATCH .../validar response), not
   * on `PagoListItemDTO` (the queue list). `true` means the approve/reject
   * itself succeeded — `estadoPago` above is final — but the in-app
   * notification to the student/guardian could not be created. Surfaced so
   * the admin sees the truth instead of a plain 200 (hallazgo en vivo,
   * 2026-08-11: before this, a failed notification meant an uncaught 500
   * with the decision already committed).
   */
  avisoNoEnviado?: boolean;
}

/** `PagoListItemDTO` — the queue list adds the student's name (denormalized server-side; not present on `PagoResponseDTO`). */
export interface BackendPagoListItem extends BackendPagoCore {
  personaNombreCompleto: string;
}

export interface BackendMembresia {
  id: number;
  estado: BackendEstadoMembresia;
  tipoMembresiaId: number;
  /**
   * The amount the membership was activated for, as a decimal string. Only
   * read when a membership has no payment behind it (see `/api/members`) —
   * every other surface takes the figure from the Pago, which is the record
   * the admin actually validated.
   */
  montoAplicado?: string | null;
  /** Owner of the membership. Only present on `GET /membresias/` list items — used to group the bulk list by persona in `/api/members`. */
  personaId?: number;
  /**
   * `MembresiaResponseDTO.es_gratuidad_familiar` (issue #400, slice 4c-a) —
   * the AUTHORITATIVE gratuity signal. A zero `montoAplicado` is NOT the
   * same thing: the backend's anomaly inventory
   * (`scripts/inventario_anomalias_membresias.py`) deliberately tracks a
   * zero price with this flag false as an "unexplained zero", distinct from
   * gratuity-coherent (flag true) and gratuity-incoherent (flag true,
   * nonzero) — nothing at the DB level enforces the pairing.
   *
   * Optional and normalized to `false` at each adapter boundary that builds
   * its own view type (never left `undefined`) so an older backend that
   * omits this field, or a hand-built test fixture, still type-checks and
   * behaves as "no gratuity" instead of throwing.
   */
  esGratuidadFamiliar?: boolean;
}

export interface BackendTipoMembresia {
  id: number;
  categoria: string;
}

/** Fields of `PersonaResponseDTO` this feature needs — `PagoResponseDTO` (returned by the validar endpoint) doesn't carry the student's name, unlike `PagoListItemDTO`. */
export interface BackendPersona {
  nombres: string;
  apellidos: string;
}

export function personaFullName(persona: BackendPersona | undefined): string {
  return persona ? `${persona.nombres} ${persona.apellidos}`.trim() : "Estudiante";
}

/**
 * Fields of `PersonaResponseDTO` needed to resolve the "responsable de
 * pago" (payer) name — a superset of `BackendPersona` with `id`/
 * `representanteId`, mirrors `BackendPersonaFull` (members-adapter.ts).
 */
export interface BackendPersonaWithRepresentante extends BackendPersona {
  id: number;
  representanteId: number | null;
}

/**
 * Resolve each persona's "responsable de pago" full name: the
 * representante's name when the persona is represented, otherwise the
 * persona's own name (self-managed). Derived locally from one paginated
 * `/personas/` fetch — same avoid-N+1 tradeoff as
 * `members-adapter.ts#buildMemberAccounts`. A dangling `representanteId`
 * (representante not present in the fetched batch) falls back to the
 * persona's own name rather than a placeholder.
 */
export function buildRepresentanteNameMap(personas: BackendPersonaWithRepresentante[]): Map<number, string> {
  const byId = new Map(personas.map((persona) => [persona.id, persona]));
  const map = new Map<number, string>();
  for (const persona of personas) {
    const payer = persona.representanteId !== null ? byId.get(persona.representanteId) : undefined;
    map.set(persona.id, personaFullName(payer ?? persona));
  }
  return map;
}

export function buildPaymentValidationRequest(
  pago: BackendPagoCore,
  studentName: string,
  membresia: BackendMembresia,
  tipoMembresia: BackendTipoMembresia | undefined,
  responsablePagoName?: string,
): PaymentValidationRequest {
  return {
    id: String(pago.id),
    studentName,
    responsablePagoName,
    // Formatted here rather than at the two render sites (`/payments` and
    // `/reports` both display this field) so the raw ISO pair cannot leak into
    // either. Safe to do server-side: `fechaInicio`/`fechaFin` are date-only
    // strings, which `formatDateRange` anchors at noon UTC — the rendered
    // calendar day is the same whether Node runs in UTC or America/Guayaquil.
    membershipPeriod: formatDateRange(pago.fechaInicio, pago.fechaFin),
    membershipType: tipoMembresia ? tipoMembresia.categoria : "Sin tipo",
    expectedAmount: Number(pago.monto),
    paymentMethod: PAYMENT_METHOD_BY_TIPO_PAGO[pago.tipoPago],
    uploadedAt: pago.fechaRegistro,
    currentMembershipStatus: MEMBERSHIP_STATUS_BY_ESTADO[membresia.estado],
    proofFileName: proofFileName(pago.voucherUrl),
    proofFileType: proofFileType(pago.voucherFormato),
    proofPreviewUrl: pago.voucherUrl ?? undefined,
    validationStatus: ESTADO_PAGO_TO_VALIDATION_STATUS[pago.estadoPago],
    validatedAt: pago.fechaValidacion ?? undefined,
    startDate: pago.fechaInicio,
    endDate: pago.fechaFin,
    // Omitted (not `false`) in the ordinary case on purpose: this field is
    // only meaningful right after a PUT /api/payments/[id], and adding a
    // `false` to every row of the queue list (GET /api/payments, which
    // reuses this same builder) would change that endpoint's shape for
    // every consumer for no reason.
    ...(pago.avisoNoEnviado ? { notificationDeliveryFailed: true as const } : {}),
  };
}

interface PaginatedPersonas {
  items: BackendPersonaWithRepresentante[];
}

interface PaginatedMembresias {
  items: BackendMembresia[];
}

/**
 * Enrich a raw `BackendPagoListItem[]` (from either the paginated queue or
 * the full reports endpoint) into `PaymentValidationRequest[]`: resolves
 * "responsable de pago" names, tipos de membresía, and membresías in bulk
 * (same avoid-N+1 tradeoff as `buildRepresentanteNameMap`). Shared by
 * `/api/payments` and `/api/payments/reportes` — both need the exact same
 * three-way batch resolution over a different upstream pago list.
 */
export async function enrichBackendPagos(
  request: NextRequest,
  pagos: BackendPagoListItem[],
): Promise<PaymentValidationRequest[]> {
  const personasResult = await backendFetchAuthed(request, "/personas/?limit=200");
  const personas: BackendPersonaWithRepresentante[] =
    (personasResult.ok && personasResult.response.ok
      ? ((await personasResult.response.json()) as PaginatedPersonas).items
      : undefined) ?? [];
  const responsablePagoNameById = buildRepresentanteNameMap(personas);

  const tiposResult = await backendFetchAuthed(request, "/membresias/tipos");
  const tipos: BackendTipoMembresia[] =
    tiposResult.ok && tiposResult.response.ok ? await tiposResult.response.json() : [];
  const tiposById = new Map(tipos.map((tipo) => [tipo.id, tipo]));

  const uniqueMembresiaIds = [...new Set(pagos.map((pago) => pago.membresiaId))];
  const membresiasResult = await backendFetchAuthed(request, "/membresias/?limit=200");
  const allMembresias: BackendMembresia[] =
    membresiasResult.ok && membresiasResult.response.ok
      ? ((await membresiasResult.response.json()) as PaginatedMembresias).items
      : [];
  const membresiaById = new Map<number, BackendMembresia>();
  for (const m of allMembresias) {
    if (uniqueMembresiaIds.includes(m.id)) {
      membresiaById.set(m.id, m);
    }
  }

  return pagos.map((pago) => {
    const membresia: BackendMembresia =
      membresiaById.get(pago.membresiaId) ?? { id: pago.membresiaId, estado: "INACTIVA", tipoMembresiaId: 0 };
    return buildPaymentValidationRequest(
      pago,
      pago.personaNombreCompleto,
      membresia,
      tiposById.get(membresia.tipoMembresiaId),
      responsablePagoNameById.get(pago.personaId),
    );
  });
}

/**
 * Enrich ONE `BackendPagoCore` (from either the validar response or a plain
 * `GET /membresias/pagos/{id}`) into a `PaymentValidationRequest`: resolves
 * the student's name, membresía and tipo de membresía — the same three-way
 * lookup `enrichBackendPagos` does for a list, sized for a single row.
 *
 * Shared by `PUT /api/payments/[id]` (issue #456: re-validated, so it needs
 * this to rebuild its response) and `GET /api/payments/[id]` (issue #456:
 * the fix's re-check endpoint — after a failed/timed-out PUT, the frontend
 * calls this to learn the payment's REAL state before deciding what to show
 * the admin, instead of assuming the optimistic snapshot was correct).
 */
export interface EnrichedSinglePago {
  item: PaymentValidationRequest;
  /** Propagate whichever of the three lookups actually refreshed the token, if any. */
  refreshedAccessToken?: string;
}

export async function enrichSinglePago(
  request: NextRequest,
  pago: BackendPagoCore,
): Promise<EnrichedSinglePago> {
  const [personaResult, membresiaResult, tiposResult] = await Promise.all([
    backendFetchAuthed(request, `/personas/${pago.personaId}`),
    backendFetchAuthed(request, `/membresias/${pago.membresiaId}`),
    backendFetchAuthed(request, "/membresias/tipos"),
  ]);

  const persona: BackendPersona | undefined =
    personaResult.ok && personaResult.response.ok ? await personaResult.response.json() : undefined;
  const membresia: BackendMembresia =
    membresiaResult.ok && membresiaResult.response.ok
      ? await membresiaResult.response.json()
      : { estado: "INACTIVA", tipoMembresiaId: 0 };
  const tipos: BackendTipoMembresia[] =
    tiposResult.ok && tiposResult.response.ok ? await tiposResult.response.json() : [];

  const tipoMembresia = tipos.find((tipo) => tipo.id === membresia.tipoMembresiaId);
  const item = buildPaymentValidationRequest(pago, personaFullName(persona), membresia, tipoMembresia);

  // Any of the three calls above may have independently refreshed the
  // token (each resolves/refreshes off the same request cookies) —
  // callers propagate whichever one actually did, same as GET /api/payments.
  const refreshedAccessToken =
    (personaResult.ok ? personaResult.refreshedAccessToken : undefined) ??
    (membresiaResult.ok ? membresiaResult.refreshedAccessToken : undefined) ??
    (tiposResult.ok ? tiposResult.refreshedAccessToken : undefined);

  return { item, refreshedAccessToken };
}

/**
 * Build the backend query string (snake_case) for the Pagos report/PDF
 * endpoints from the incoming request's camelCase params. Shared by
 * `/api/payments/reportes` and its `/pdf` sibling — both take the exact
 * same three optional filters.
 */
export function buildPagosReporteQuery(searchParams: URLSearchParams): string {
  const qs = new URLSearchParams();
  const fechaInicio = searchParams.get("fechaInicio");
  const fechaFin = searchParams.get("fechaFin");
  const estadoPago = searchParams.get("estadoPago");
  if (fechaInicio) qs.set("fecha_inicio", fechaInicio);
  if (fechaFin) qs.set("fecha_fin", fechaFin);
  if (estadoPago) qs.set("estado_pago", estadoPago);
  const query = qs.toString();
  return query ? `?${query}` : "";
}
