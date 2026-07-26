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
import { backendFetchAuthed } from "@/lib/server/backend-client";
import { formatDateRange } from "@/lib/format-utils";

export type BackendEstadoPago = "APROBADO" | "PENDIENTE_VALIDACION" | "RECHAZADO";
export type BackendTipoPago = "EFECTIVO" | "TRANSFERENCIA";

const VALIDATION_STATUS_BY_ESTADO_PAGO: Record<BackendEstadoPago, ValidationStatus> = {
  APROBADO: "validado",
  PENDIENTE_VALIDACION: "pendiente",
  RECHAZADO: "rechazado",
};

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
}

export interface BackendTipoMembresia {
  id: number;
  categoria: string;
  franjaHoraria: string;
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
 * `members-adapter.ts#buildMemberAccounts` and
 * `attendance-adapter.ts#fetchPersonaNameMap`. A dangling `representanteId`
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
    membershipType: tipoMembresia ? `${tipoMembresia.categoria} (${tipoMembresia.franjaHoraria})` : "Sin tipo",
    expectedAmount: Number(pago.monto),
    paymentMethod: PAYMENT_METHOD_BY_TIPO_PAGO[pago.tipoPago],
    uploadedAt: pago.fechaRegistro,
    currentMembershipStatus: MEMBERSHIP_STATUS_BY_ESTADO[membresia.estado],
    proofFileName: proofFileName(pago.voucherUrl),
    proofFileType: proofFileType(pago.voucherFormato),
    proofPreviewUrl: pago.voucherUrl ?? undefined,
    validationStatus: VALIDATION_STATUS_BY_ESTADO_PAGO[pago.estadoPago],
    validatedAt: pago.fechaValidacion ?? undefined,
    startDate: pago.fechaInicio,
    endDate: pago.fechaFin,
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
