/**
 * GET /api/auth/consentimiento-legal — whether the logged-in account must
 * accept the current version of the terms (S8).
 *
 * BFF passthrough for `GET /auth/consentimiento-legal`. The identity is the
 * access-token cookie; the route takes no account identifier.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, "/auth/consentimiento-legal");

  if (!result.ok) {
    return NextResponse.json(
      { message: "No se pudo consultar la aceptación de los términos." },
      { status: result.status },
    );
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo consultar la aceptación de los términos.");
  }

  const response = NextResponse.json(await result.response.json());
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
