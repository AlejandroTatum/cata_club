/**
 * BFF proxy — /api/attendance/correction-requests (QA4 ENT-25)
 *
 * GET  → FastAPI `GET /asistencias/solicitudes-correccion`: a trainer gets only
 *        their own requests, an administrator all of them (the backend decides
 *        from the token). Only the documented filters are forwarded.
 * POST → `POST /asistencias/solicitudes-correccion`: the trainer asks
 *        administration to correct one filed attendance row. The request DTO is
 *        a plain snake_case `BaseModel`, so the body is translated by hand; the
 *        response is `ResponseBase` (camelCase, backend enum strings) and goes
 *        through untouched — the client maps the states.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  badRequestResponse,
  extractAccessToken,
  parseJsonBody,
  proxyToBackend,
  unauthorizedResponse,
} from "@/lib/server/bff-helpers";
import { ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND } from "@/lib/server/attendance-adapter";

const FORWARDED_FILTERS = ["estado", "horario_id", "fecha"] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const query = new URLSearchParams();
  for (const name of FORWARDED_FILTERS) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) query.set(name, value);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return proxyToBackend(`/asistencias/solicitudes-correccion${suffix}`, { method: "GET", accessToken });
}

interface CreateBody {
  asistenciaId?: unknown;
  estado?: unknown;
  motivo?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [rawBody, bodyError] = await parseJsonBody(request);
  if (bodyError) return bodyError;

  const body = rawBody as CreateBody;
  if (typeof body.asistenciaId !== "number" || !Number.isInteger(body.asistenciaId) || body.asistenciaId <= 0) {
    return badRequestResponse("El id de asistencia no es válido.");
  }
  if (typeof body.estado !== "string" || !Object.hasOwn(ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND, body.estado)) {
    return badRequestResponse("El estado de asistencia no es válido.");
  }
  if (typeof body.motivo !== "string" || body.motivo.trim().length === 0) {
    return badRequestResponse("Indique el motivo de la corrección.");
  }

  return proxyToBackend("/asistencias/solicitudes-correccion", {
    method: "POST",
    accessToken,
    successStatus: 201,
    body: {
      asistencia_id: body.asistenciaId,
      estado_solicitado:
        ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND[body.estado as keyof typeof ESTADO_ASISTENCIA_FRONTEND_TO_BACKEND],
      motivo: body.motivo.trim(),
    },
  });
}
