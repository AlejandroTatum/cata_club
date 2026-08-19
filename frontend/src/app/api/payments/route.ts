/**
 * GET /api/payments — proxies FastAPI's admin payment-validation queue,
 * paginated.
 *
 * BFF Route Handler: reads the session cookie server-side, calls the real
 * backend's paginated `GET /membresias/pagos` with `Authorization: Bearer`,
 * and translates the response into the `PaymentValidationRequest` shape
 * `src/app/payments/page.tsx` renders (see src/lib/server/payments-adapter.ts).
 * Role enforcement (admin-only) is the backend's job via `GestorPermisos` —
 * this handler just proxies whatever status it returns.
 *
 * Issue #400 (criterio 4/5): this used to hardcode `?limit=200` and return a
 * bare array, so the queue silently truncated at 200 requests with no error
 * and no signal — a club with more history than that lost the rest. The
 * backend has supported real `skip`/`limit` pagination (with an accurate
 * `total`, independent of `limit`) since before this fix; this handler was
 * simply not using it. Query params, all optional:
 *
 *   - `skip` (default 0)
 *   - `limit` (default 200 — preserves `fetchPaymentValidations()`'s old
 *     unpaginated behaviour for callers that just want "whatever's there",
 *     e.g. the dashboard)
 *   - `estadoPago` — forwarded as the backend's `estado_pago` filter, so a
 *     single-status page (e.g. "Pendientes") reports an accurate `total`
 *     for THAT status, not for the whole table.
 *
 * Response shape changed from a bare array to `{ items, total }` — `total`
 * is what makes real multi-page navigation possible; see
 * `fetchPaymentValidationsPage` in src/services/api.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { enrichBackendPagos, type BackendPagoListItem } from "@/lib/server/payments-adapter";

interface PaginatedPagos {
  items: BackendPagoListItem[];
  total: number;
}

const DEFAULT_LIMIT = 200;
const VALID_ESTADOS_PAGO = new Set(["PENDIENTE_VALIDACION", "APROBADO", "RECHAZADO"]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const skip = Number(searchParams.get("skip") ?? "0");
  const limit = Number(searchParams.get("limit") ?? String(DEFAULT_LIMIT));
  const estadoPago = searchParams.get("estadoPago");

  if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(limit) || limit < 1) {
    return NextResponse.json({ message: "Los parámetros de paginación no son válidos." }, { status: 400 });
  }
  if (estadoPago !== null && !VALID_ESTADOS_PAGO.has(estadoPago)) {
    return NextResponse.json({ message: "El estado de pago indicado no es válido." }, { status: 400 });
  }

  const qs = new URLSearchParams({ skip: String(skip), limit: String(limit) });
  if (estadoPago) qs.set("estado_pago", estadoPago);

  const pagosResult = await backendFetchAuthed(request, `/membresias/pagos?${qs.toString()}`);
  if (!pagosResult.ok) {
    return NextResponse.json({ message: "No se pudo cargar la cola de pagos." }, { status: pagosResult.status });
  }
  if (!pagosResult.response.ok) {
    return passthroughBackendError(pagosResult.response, "No se pudo cargar la cola de pagos.");
  }

  const paginated = (await pagosResult.response.json()) as PaginatedPagos;
  const items = await enrichBackendPagos(request, paginated.items);

  const response = NextResponse.json({ items, total: paginated.total });
  if (pagosResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: pagosResult.refreshedAccessToken });
  }
  return response;
}
