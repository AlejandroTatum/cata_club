/**
 * GET /api/attendance/records/[id]/corrections — proxies FastAPI's
 * `GET /asistencias/{id}/correcciones` (issue #389, slice 4b).
 *
 * The audit trail for one Asistencia row, most-recent-first as the backend
 * already orders it. ADMINISTRADOR-only in the backend, same as `.../correct`.
 * `AsistenciaCorreccionEntryDTO` IS `ResponseBase` (camelCase on the wire),
 * so no snake_case translation is needed on this side — only `estadoAnterior`
 * needs mapping from the raw backend enum to the frontend's `EstadoAsistencia`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND, type BackendEstadoAsistencia } from "@/lib/server/attendance-adapter";

interface RouteContext {
  params: { id: string };
}

interface BackendCorreccionEntry {
  id: number;
  corregidoPorId: number;
  corregidoPorNombre: string;
  corregidoEn: string;
  motivo: string;
  estadoAnterior: BackendEstadoAsistencia;
  justificativoAnterior?: string | null;
  estadoJustificativoAnterior?: boolean | null;
}

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const asistenciaId = Number(params.id);
  if (!Number.isInteger(asistenciaId) || asistenciaId <= 0) {
    return NextResponse.json({ message: "El id de asistencia no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/asistencias/${asistenciaId}/correcciones`);
  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo cargar el historial de correcciones." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo cargar el historial de correcciones.");
  }

  const entries = (await result.response.json()) as BackendCorreccionEntry[];
  const response = NextResponse.json(
    entries.map((entry) => ({
      id: entry.id,
      corregidoPorId: entry.corregidoPorId,
      corregidoPorNombre: entry.corregidoPorNombre,
      corregidoEn: entry.corregidoEn,
      motivo: entry.motivo,
      estadoAnterior: ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND[entry.estadoAnterior],
      justificativoAnterior: entry.justificativoAnterior ?? null,
      estadoJustificativoAnterior: entry.estadoJustificativoAnterior ?? null,
    })),
  );
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
