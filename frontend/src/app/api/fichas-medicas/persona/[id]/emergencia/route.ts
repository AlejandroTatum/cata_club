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
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { setAuthCookies } from "@/lib/server/auth";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";
import { resolveEffectiveEmergencyContact, type EmergencyContactSource } from "@/lib/server/emergency-contact";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ERROR_MESSAGE = "No se pudo cargar la ficha de emergencia.";

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parseNumericIdOrBadRequest((await context.params).id, "persona");
  if (personaId instanceof NextResponse) return personaId;

  const result = await backendFetchAuthed(request, `/fichas-medicas/persona/${personaId}/emergencia`);
  if (!result.ok) {
    return NextResponse.json({ message: ERROR_MESSAGE }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, ERROR_MESSAGE);
  }

  // Issue #1667: the effective contact is resolved here, once, so every screen agrees.
  const ficha = (await result.response.json()) as EmergencyContactSource;
  const response = NextResponse.json({ ...ficha, contactoEfectivo: resolveEffectiveEmergencyContact(ficha) });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
