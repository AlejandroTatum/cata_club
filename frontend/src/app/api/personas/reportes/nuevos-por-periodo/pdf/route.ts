/**
 * GET /api/personas/reportes/nuevos-por-periodo/pdf — admin-only BFF binary proxy.
 *
 * Proxies FastAPI's `/personas/reportes/nuevos-por-periodo/pdf` with the
 * required date-range query params, relaying the `application/pdf` body
 * plus `Content-Disposition` verbatim. Mirrors
 * `/api/personas/reportes/nuevos-por-periodo/route.ts` but reads the
 * backend response as `arrayBuffer()` instead of `json()`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
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
  const result = await backendFetchAuthed(request, `/personas/reportes/nuevos-por-periodo/pdf?${qs.toString()}`);
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo generar el PDF del reporte." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo generar el PDF del reporte.");
  }

  const body = await result.response.arrayBuffer();
  const contentDisposition =
    result.response.headers.get("content-disposition") ??
    `attachment; filename="reporte-periodo.pdf"`;

  const response = new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition,
    },
  });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
