/**
 * GET /api/membresias/persona/[id] — fetch memberships for a persona.
 * Proxies to FastAPI's GET /membresias/persona/{persona_id} (ADMIN only).
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number((await context.params).id);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/membresias/persona/${personaId}`);

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudieron cargar las membresías." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudieron cargar las membresías.");
  }

  const data = await result.response.json();
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
