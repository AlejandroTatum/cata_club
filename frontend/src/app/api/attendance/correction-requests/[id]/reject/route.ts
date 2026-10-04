/**
 * BFF proxy — POST /api/attendance/correction-requests/[id]/reject
 *
 * Proxies FastAPI's `POST /asistencias/solicitudes-correccion/{id}/rechazar`
 * (QA4 ENT-25). ADMINISTRADOR-only in the backend; the reason is mandatory
 * because the trainer reads it as the outcome.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  badRequestResponse,
  extractAccessToken,
  parseJsonBody,
  proxyToBackend,
  unauthorizedResponse,
} from "@/lib/server/bff-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return badRequestResponse("El id de la solicitud no es válido.");

  const [rawBody, bodyError] = await parseJsonBody(request);
  if (bodyError) return bodyError;
  const motivo = (rawBody as { motivo?: unknown }).motivo;
  if (typeof motivo !== "string" || motivo.trim().length === 0) {
    return badRequestResponse("Indique por qué se rechaza la solicitud.");
  }

  return proxyToBackend(`/asistencias/solicitudes-correccion/${id}/rechazar`, {
    method: "POST",
    accessToken,
    body: { motivo: motivo.trim() },
  });
}
