/**
 * GET /api/asistencias/reportes/pdf — admin-only BFF binary proxy.
 *
 * Proxies FastAPI's `/asistencias/reportes/pdf` (deliberately narrower gate
 * than the JSON `/asistencias/reportes`, which also allows ENTRENADOR — see
 * `backend/app/presentacion/routers/asistencias_router.py`) with the same
 * optional filters as `fetchAttendanceRecords`, relaying the
 * `application/pdf` body plus `Content-Disposition` verbatim.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const horarioId = searchParams.get("horarioId");
  const personaId = searchParams.get("personaId");
  const fechaInicio = searchParams.get("fechaInicio");
  const fechaFin = searchParams.get("fechaFin");
  if (horarioId !== null) qs.set("horario_id", horarioId);
  if (personaId !== null) qs.set("persona_id", personaId);
  if (fechaInicio !== null) qs.set("fecha_inicio", fechaInicio);
  if (fechaFin !== null) qs.set("fecha_fin", fechaFin);
  const query = qs.toString();

  const result = await backendFetchAuthed(request, `/asistencias/reportes/pdf${query ? `?${query}` : ""}`);
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo generar el PDF del reporte." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo generar el PDF del reporte.");
  }

  const body = await result.response.arrayBuffer();
  const contentDisposition =
    result.response.headers.get("content-disposition") ??
    `attachment; filename="reporte-asistencia.pdf"`;

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
