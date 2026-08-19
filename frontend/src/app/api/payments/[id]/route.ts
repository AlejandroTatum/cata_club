/**
 * PUT /api/payments/[id] — proxies FastAPI's payment validation endpoint.
 *
 * Approve or reject a membership payment validation request (CU012).
 * Calls `PATCH /membresias/pagos/{id}/validar`, whose response
 * (`PagoResponseDTO`) doesn't carry the student's name (only
 * `PagoListItemDTO`, the queue list, denormalizes that) — so this handler
 * also fetches the persona and membresia/tipo in parallel to rebuild the
 * same `PaymentValidationRequest` shape the GET route returns (see
 * src/lib/server/payments-adapter.ts).
 *
 * Request body (approve):
 *   { "action": "approved" }
 * Request body (reject):
 *   { "action": "rejected", "rejectionReason": "string" }
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import {
  buildPaymentValidationRequest,
  personaFullName,
  type BackendMembresia,
  type BackendPagoCore,
  type BackendPersona,
  type BackendTipoMembresia,
} from "@/lib/server/payments-adapter";

type ParsedUpdateBody =
  | { action: "approved" }
  | { action: "rejected"; rejectionReason: string };

/**
 * Mirrors the `UpdatePaymentValidationDTO` contract `updatePaymentValidation()` in src/services/api.ts sends — do not change without updating that client.
 *
 * A stale client that still sends `startDate`/`endDate` on approve (issue
 * #400: Administración can no longer edit coverage dates at validation
 * time) has them silently dropped here, same posture as `descuento_ids` in
 * an earlier slice — never forwarded, never a 400.
 */
function parseUpdateBody(value: unknown): ParsedUpdateBody | { error: string } {
  if (typeof value !== "object" || value === null) {
    return { error: "Acción inválida. Use 'approved' o 'rejected'." };
  }
  const body = value as Record<string, unknown>;

  if (body.action === "approved") {
    return { action: "approved" };
  }

  if (body.action === "rejected") {
    const reason = body.rejectionReason;
    if (typeof reason !== "string" || reason.trim().length === 0) {
      return { error: "El motivo de rechazo es obligatorio y no debe estar vacío" };
    }
    return { action: "rejected", rejectionReason: reason.trim() };
  }

  return { error: "Acción inválida. Use 'approved' o 'rejected'." };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ message: "JSON inválido en el cuerpo de la solicitud" }, { status: 400 });
  }

  const parsed = parseUpdateBody(rawBody);
  if ("error" in parsed) {
    return NextResponse.json({ message: parsed.error }, { status: 400 });
  }

  const validarBody: Record<string, unknown> =
    parsed.action === "approved"
      ? { estado_pago: "APROBADO" }
      : { estado_pago: "RECHAZADO", motivo_rechazo: parsed.rejectionReason };

  const validarResult = await backendFetchAuthed(request, `/membresias/pagos/${params.id}/validar`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validarBody),
  });
  if (!validarResult.ok) {
    return NextResponse.json({ message: "No se pudo validar el pago." }, { status: validarResult.status });
  }
  if (!validarResult.response.ok) {
    return passthroughBackendError(validarResult.response, "No se pudo validar el pago.");
  }

  const pago = (await validarResult.response.json()) as BackendPagoCore;

  // `/membresias/tipos` is a small, rarely-changing catalog (see the N+1
  // note in payments-adapter.ts) — fetching it in full alongside the two
  // per-payment lookups is cheap and keeps this handler's shape consistent
  // with GET /api/payments.
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

  const response = NextResponse.json(item);
  // Any of the four calls above may have independently refreshed the token
  // (each resolves/refreshes off the same request cookies) — propagate
  // whichever one actually did, same as GET /api/payments.
  const refreshedAccessToken =
    validarResult.refreshedAccessToken ??
    (personaResult.ok ? personaResult.refreshedAccessToken : undefined) ??
    (membresiaResult.ok ? membresiaResult.refreshedAccessToken : undefined) ??
    (tiposResult.ok ? tiposResult.refreshedAccessToken : undefined);
  if (refreshedAccessToken) {
    setAuthCookies(response, { accessToken: refreshedAccessToken });
  }
  return response;
}
