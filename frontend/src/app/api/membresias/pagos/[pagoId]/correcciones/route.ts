/**
 * GET /api/membresias/pagos/:pagoId/correcciones — correction history of a
 * pago (issue #400, criterio 7).
 *
 * Proxies FastAPI's `GET /membresias/pagos/{pago_id}/correcciones`
 * (admin-only, `GestorPermisos(ROL_ADMIN)`). Response is already camelCase
 * and frontend-shaped (`list[CorreccionPagoResponseDTO]`), so this handler
 * passes it through unmodified — same pattern as `.../pagos/persona/[id]/route.ts`.
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

  const result = await backendFetchAuthed(request, `/membresias/pagos/${pagoId}/correcciones`);
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo cargar el historial de correcciones." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cargar el historial de correcciones.");
  }

  const body = await result.response.json();
  const response = NextResponse.json(body);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
