/**
 * GET /api/membresias/[id]/regularizar-deuda/cotizacion — the amount a
 * regularization must carry for a period (QA3 ADM-09).
 *
 * BFF proxy to FastAPI's `GET /membresias/{id}/regularizar-deuda/cotizacion`
 * (ADMINISTRADOR-only). The UI speaks camelCase dates; the backend expects
 * `fecha_inicio`/`fecha_fin` query params.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ERROR_FALLBACK = "No se pudo calcular el monto de la regularización.";

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const membresiaId = parseNumericIdOrBadRequest((await context.params).id, "membresía");
  if (membresiaId instanceof NextResponse) return membresiaId;

  const { searchParams } = new URL(request.url);
  const fechaInicio = searchParams.get("fechaInicio");
  const fechaFin = searchParams.get("fechaFin");
  if (!fechaInicio || !fechaFin) {
    return NextResponse.json({ message: "Las fechas son obligatorias." }, { status: 400 });
  }

  const query = new URLSearchParams({ fecha_inicio: fechaInicio, fecha_fin: fechaFin });
  const aplicarDescuento = searchParams.get("aplicarDescuento");
  if (aplicarDescuento !== null) query.set("aplicar_descuento", aplicarDescuento);
  const result = await backendFetchAuthed(
    request,
    `/membresias/${membresiaId}/regularizar-deuda/cotizacion?${query.toString()}`,
  );

  if (!result.ok) {
    return NextResponse.json({ message: ERROR_FALLBACK }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, ERROR_FALLBACK);
  }

  const response = NextResponse.json(await result.response.json());
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
