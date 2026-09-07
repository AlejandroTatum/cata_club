/**
 * GET /api/fichas-medicas/persona/[id]/emergencia — issue #360.
 *
 * BFF proxy to FastAPI's `GET /fichas-medicas/persona/{persona_id}/emergencia`,
 * a DIFFERENT endpoint from its sibling `route.ts` one directory up: this one
 * exposes only the seven emergency fields (`FichaEmergenciaResponseDTO`), is
 * ADMINISTRADOR-or-ENTRENADOR (not admin/representante/titular), and every
 * consulted alumno is audited backend-side. See the backend router's own
 * comment for why this can't reuse the full-record endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { proxyBackendGet } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parseNumericIdOrBadRequest((await context.params).id, "persona");
  if (personaId instanceof NextResponse) return personaId;

  return proxyBackendGet(
    request,
    `/fichas-medicas/persona/${personaId}/emergencia`,
    "No se pudo cargar la ficha de emergencia.",
  );
}
