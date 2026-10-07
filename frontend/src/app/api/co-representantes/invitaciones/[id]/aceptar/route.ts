/**
 * POST /api/co-representantes/invitaciones/[id]/aceptar — the invited account
 * accepts a pending guardian invitation. Issue #1666.
 *
 * BFF proxy to FastAPI's `POST /co-representantes/invitaciones/{id}/aceptar`.
 * The session of the invited account is the consent; the backend answers 404
 * for any invitation that is not theirs. This route holds no ownership logic
 * and forwards 401/403/404 untouched.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MENSAJE_ERROR = "No se pudo aceptar la invitación.";

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const invitacionId = parseNumericIdOrBadRequest((await context.params).id, "invitación");
  if (invitacionId instanceof NextResponse) return invitacionId;

  const result = await backendFetchAuthed(request, `/co-representantes/invitaciones/${invitacionId}/aceptar`, {
    method: "POST",
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
