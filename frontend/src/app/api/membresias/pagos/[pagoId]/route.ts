/**
 * GET /api/membresias/pagos/:pagoId — a single pago's own detail, any
 * status.
 *
 * Proxies FastAPI's `GET /membresias/pagos/{pago_id}` (dueño/representante/
 * admin authorization enforced backend-side, `PagoServicio.obtener_pago`).
 * Issue #400 (criterio 7/8): the admin queue's list view (`PagoListItemDTO`,
 * `GET /api/payments`) never carried `comprobanteOficialUrl` — this is the
 * one extra round trip `/payments/page.tsx` makes when it opens the detail
 * of an ALREADY VALIDATED payment, alongside `.../correcciones`, to fetch
 * both the fresh comprobante link and the correction history. Response is
 * already camelCase and frontend-shaped (`PagoResponseDTO`), so this
 * handler passes it through unmodified — same pattern as
 * `.../pagos/persona/[id]/route.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function GET(
  request: NextRequest,
  { params }: { params: { pagoId: string } },
): Promise<NextResponse> {
  const pagoId = Number(params.pagoId);
  if (!Number.isInteger(pagoId)) {
    return NextResponse.json({ message: "El id de pago no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/membresias/pagos/${pagoId}`);
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo cargar el pago." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cargar el pago.");
  }

  const body = await result.response.json();
  const response = NextResponse.json(body);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
