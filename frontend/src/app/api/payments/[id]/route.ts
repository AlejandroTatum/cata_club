/**
 * GET/PUT /api/payments/[id] — proxies FastAPI's single-payment endpoints.
 *
 * PUT approves or rejects a membership payment validation request (CU012).
 * Calls `PATCH /membresias/pagos/{id}/validar`, whose response
 * (`PagoResponseDTO`) doesn't carry the student's name (only
 * `PagoListItemDTO`, the queue list, denormalizes that) — so this handler
 * also fetches the persona and membresia/tipo in parallel to rebuild the
 * same `PaymentValidationRequest` shape the GET route returns (see
 * `enrichSinglePago` in src/lib/server/payments-adapter.ts).
 *
 * Request body (approve):
 *   { "action": "approved" }
 * Request body (reject):
 *   { "action": "rejected", "rejectionReason": "string" }
 *
 * GET re-checks one payment's REAL current state — added for issue #456.
 * When a PUT above times out, drops the connection, or comes back with an
 * error, the frontend cannot tell "nothing happened" from "the write landed
 * anyway, the response just never arrived" (a real, reproduced failure mode:
 * the backend commits, the client only sees a network error). This is what
 * `frontend/src/app/payments/page.tsx` calls after such a failure, instead
 * of assuming either outcome.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { enrichSinglePago, type BackendPagoCore } from "@/lib/server/payments-adapter";

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
  const { item, refreshedAccessToken: enrichRefreshedToken } = await enrichSinglePago(request, pago);

  const response = NextResponse.json(item);
  // Either the validar call or any of the three enrichment lookups may have
  // independently refreshed the token (each resolves/refreshes off the same
  // request cookies) — propagate whichever one actually did, same as GET
  // /api/payments.
  const refreshedAccessToken = validarResult.refreshedAccessToken ?? enrichRefreshedToken;
  if (refreshedAccessToken) {
    setAuthCookies(response, { accessToken: refreshedAccessToken });
  }
  return response;
}

/**
 * GET /api/payments/[id] — one payment's REAL current state (issue #456).
 *
 * Calls `GET /membresias/pagos/{id}` (admin-authorized, same as every other
 * route here) and enriches it the same way PUT's response is built. No
 * caching: this exists specifically to be trusted over whatever the caller's
 * last optimistic guess was.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const pagoResult = await backendFetchAuthed(request, `/membresias/pagos/${params.id}`);
  if (!pagoResult.ok) {
    return NextResponse.json({ message: "No se pudo consultar el pago." }, { status: pagoResult.status });
  }
  if (!pagoResult.response.ok) {
    return passthroughBackendError(pagoResult.response, "No se pudo consultar el pago.");
  }

  const pago = (await pagoResult.response.json()) as BackendPagoCore;
  const { item, refreshedAccessToken: enrichRefreshedToken } = await enrichSinglePago(request, pago);

  const response = NextResponse.json(item);
  const refreshedAccessToken = pagoResult.refreshedAccessToken ?? enrichRefreshedToken;
  if (refreshedAccessToken) {
    setAuthCookies(response, { accessToken: refreshedAccessToken });
  }
  return response;
}
