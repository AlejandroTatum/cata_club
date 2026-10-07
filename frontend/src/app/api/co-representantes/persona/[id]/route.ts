/**
 * DELETE /api/co-representantes/persona/[id] — the primary guardian (or an
 * admin) removes the second guardian of a minor. Issue #1666.
 *
 * BFF proxy to FastAPI's `DELETE /co-representantes/persona/{persona_id}`.
 * The backend revokes the second guardian's access on the very next request;
 * this route holds no ownership logic and forwards 401/403/404 untouched.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MENSAJE_ERROR = "No se pudo quitar al segundo representante.";

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parseNumericIdOrBadRequest((await context.params).id, "persona");
  if (personaId instanceof NextResponse) return personaId;

  const result = await backendFetchAuthed(request, `/co-representantes/persona/${personaId}`, {
    method: "DELETE",
  });

  if (!result.ok) {
    return NextResponse.json({ message: MENSAJE_ERROR }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, MENSAJE_ERROR);
  }

  const response = new NextResponse(null, { status: 204 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
