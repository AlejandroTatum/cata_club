/**
 * PATCH /api/attendance/records/[id]/correct — proxies FastAPI's
 * `PATCH /asistencias/{id}/corregir` (issue #389, slice 4b).
 *
 * The dedicated correction door, distinct from `POST /api/attendance/records`
 * (which the backend now refuses a second time for an already-filed row).
 * ADMINISTRADOR-only in the backend — this route just relays whatever status
 * FastAPI returns (403 for a non-admin, 400 past the 30-day window, 404 for a
 * bad id, 422 for an empty `motivo`).
 *
 * Casing: `AsistenciaCorreccionDTO` is a plain request `BaseModel` with no
 * `alias_generator` (unlike the `ResponseBase`-backed response DTOs), so —
 * same as `AsistenciaCreateDTO` in `../../route.ts` — the outgoing body has
 * to be snake_case by hand. The response DTOs (`AsistenciaCorreccionResponseDTO`
 * and the nested `AsistenciaResponseDTO`) ARE `ResponseBase`, so they arrive
 * camelCase; the nested `asistencia` still gets run through
 * `buildAttendanceRecord` so it matches the same `AttendanceRecord` shape
 * every other attendance route returns (no horario lookup here, so the label
 * falls back to `Horario {id}` — see that adapter's documented gap).
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import {
  buildAttendanceRecord,
  ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND,
  ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND,
  type BackendAsistencia,
  type BackendEstadoAsistencia,
} from "@/lib/server/attendance-adapter";
import type { EstadoAsistencia } from "@/types/domain";

interface RouteContext {
  params: { id: string };
}

const VALID_ESTADOS = new Set<string>(Object.keys(ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND));

interface CorrectionRequestBody {
  estado: EstadoAsistencia;
  justificativo: string | null;
  estadoJustificativo: boolean | null;
  motivo: string;
}

function parseBody(value: unknown): CorrectionRequestBody | { error: string } {
  if (typeof value !== "object" || value === null) {
    return { error: "Cuerpo de la solicitud inválido." };
  }
  const body = value as Record<string, unknown>;

  if (typeof body.estado !== "string" || !VALID_ESTADOS.has(body.estado)) {
    return { error: `Estado de asistencia inválido: ${String(body.estado)}` };
  }
  if (typeof body.motivo !== "string" || body.motivo.trim().length === 0) {
    return { error: "El motivo de la corrección es obligatorio." };
  }
  if (body.justificativo !== undefined && body.justificativo !== null && typeof body.justificativo !== "string") {
    return { error: "justificativo debe ser texto." };
  }
  if (
    body.estadoJustificativo !== undefined &&
    body.estadoJustificativo !== null &&
    typeof body.estadoJustificativo !== "boolean"
  ) {
    return { error: "estadoJustificativo debe ser booleano." };
  }

  return {
    estado: body.estado as EstadoAsistencia,
    justificativo: (body.justificativo as string | null | undefined) ?? null,
    estadoJustificativo: (body.estadoJustificativo as boolean | null | undefined) ?? null,
    motivo: body.motivo,
  };
}

interface BackendCorreccionResponse {
  asistencia: BackendAsistencia;
  corregidoPorId: number;
  corregidoPorNombre: string;
  corregidoEn: string;
  motivo: string;
  estadoAnterior: BackendEstadoAsistencia;
  justificativoAnterior?: string | null;
  estadoJustificativoAnterior?: boolean | null;
}

export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const asistenciaId = Number(params.id);
  if (!Number.isInteger(asistenciaId) || asistenciaId <= 0) {
    return NextResponse.json({ message: "El id de asistencia no es válido." }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ message: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  const parsed = parseBody(rawBody);
  if ("error" in parsed) {
    return NextResponse.json({ message: parsed.error }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/asistencias/${asistenciaId}/corregir`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      estado: ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND[parsed.estado],
      justificativo: parsed.justificativo,
      estado_justificativo: parsed.estadoJustificativo,
      motivo: parsed.motivo,
    }),
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo registrar la corrección." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo registrar la corrección.");
  }

  const data = (await result.response.json()) as BackendCorreccionResponse;
  const response = NextResponse.json({
    asistencia: buildAttendanceRecord(data.asistencia, undefined),
    corregidoPorId: data.corregidoPorId,
    corregidoPorNombre: data.corregidoPorNombre,
    corregidoEn: data.corregidoEn,
    motivo: data.motivo,
    estadoAnterior: ESTADO_ASISTENCIA_BACKEND_TO_FRONTEND[data.estadoAnterior],
    justificativoAnterior: data.justificativoAnterior ?? null,
    estadoJustificativoAnterior: data.estadoJustificativoAnterior ?? null,
  });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
