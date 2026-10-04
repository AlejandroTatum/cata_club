/**
 * POST /api/personas/[id]/entrenador/invitacion — an ADMINISTRADOR resends a
 * trainer's invitation email while the trainer has not set a password yet
 * (issue #1575).
 *
 * BFF proxy to FastAPI's `POST /personas/{persona_id}/entrenador/invitacion`
 * (204). The shared client always parses JSON on 2xx, so success answers
 * `{ success: true }` instead of relaying the empty 204.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const FALLBACK = "No se pudo reenviar la invitación.";

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parseNumericIdOrBadRequest((await context.params).id, "persona");
  if (personaId instanceof NextResponse) return personaId;

  const result = await backendFetchAuthed(request, `/personas/${personaId}/entrenador/invitacion`, {
    method: "POST",
  });

  if (!result.ok) {
    return NextResponse.json({ message: FALLBACK }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, FALLBACK);
  }

  const response = NextResponse.json({ success: true });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
