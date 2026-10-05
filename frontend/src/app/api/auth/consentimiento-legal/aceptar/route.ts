/**
 * POST /api/auth/consentimiento-legal/aceptar — the logged-in account accepts
 * the current version of the terms (S8).
 *
 * BFF passthrough for `POST /auth/consentimiento-legal/aceptar`. No body is
 * forwarded: the backend records the acceptance for the token's own account
 * and nobody else's.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, "/auth/consentimiento-legal/aceptar", {
    method: "POST",
  });

  if (!result.ok) {
    return NextResponse.json({ message: "No se pudo registrar la aceptación." }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, "No se pudo registrar la aceptación.");
  }

  const response = NextResponse.json(await result.response.json());
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
