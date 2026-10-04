/**
 * BFF proxy — POST /api/attendance/correction-requests/[id]/approve
 *
 * Proxies FastAPI's `POST /asistencias/solicitudes-correccion/{id}/aprobar`
 * (QA4 ENT-25). ADMINISTRADOR-only in the backend, which applies the audited
 * correction; this route relays whatever status it answers.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  badRequestResponse,
  extractAccessToken,
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

  return proxyToBackend(`/asistencias/solicitudes-correccion/${id}/aprobar`, { method: "POST", accessToken });
}
