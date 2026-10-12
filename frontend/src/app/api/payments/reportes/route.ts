/**
 * GET /api/payments/reportes — proxies FastAPI's admin payments report
 * (Reportes page "Pagos" tab).
 *
 * BFF Route Handler: reads the session cookie server-side, calls the real
 * backend (`GET /membresias/pagos/reportes`, which — unlike the paginated
 * queue `GET /membresias/pagos` — returns every matching row, not just one
 * page) with `Authorization: Bearer`, and translates the response into the
 * `PaymentValidationRequest` shape via the same enrichment `/api/payments`
 * already uses. Role enforcement (admin-only) is the backend's job via
 * `GestorPermisos` — this handler just proxies whatever status it returns.
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshedTokenCookies, setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import {
  buildPagosReporteQuery,
  enrichBackendPagos,
  type BackendPagoListItem,
} from "@/lib/server/payments-adapter";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const query = buildPagosReporteQuery(searchParams);

  const pagosResult = await backendFetchAuthed(request, `/membresias/pagos/reportes${query}`);
  if (!pagosResult.ok) {
    return NextResponse.json({ message: "No se pudo cargar el reporte de pagos." }, { status: pagosResult.status });
  }
  if (!pagosResult.response.ok) {
    return passthroughBackendError(pagosResult.response, "No se pudo cargar el reporte de pagos.");
  }

  const pagos = (await pagosResult.response.json()) as BackendPagoListItem[];
  const items = await enrichBackendPagos(request, pagos);

  const response = NextResponse.json(items);
  if (pagosResult.refreshedAccessToken) {
    setAuthCookies(response, refreshedTokenCookies(pagosResult));
  }
  return response;
}
