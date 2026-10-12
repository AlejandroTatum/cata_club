/**
 * GET /api/personas/reportes/nuevos-por-periodo — admin-only BFF proxy.
 *
 * Proxies FastAPI's `/personas/reportes/nuevos-por-periodo` with date range query params.
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshedTokenCookies, setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const fechaInicio = searchParams.get("fecha_inicio");
  const fechaFin = searchParams.get("fecha_fin");

  if (!fechaInicio || !fechaFin) {
    return NextResponse.json(
      { message: "Los parámetros fecha_inicio y fecha_fin son obligatorios." },
      { status: 400 },
    );
  }

  const qs = new URLSearchParams({ fecha_inicio: fechaInicio, fecha_fin: fechaFin });
  const result = await backendFetchAuthed(request, `/personas/reportes/nuevos-por-periodo?${qs.toString()}`);
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudieron cargar los reportes." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudieron cargar los reportes.");
  }

  const body = await result.response.json();
  const response = NextResponse.json(body);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, refreshedTokenCookies(result));
  }
  return response;
}
