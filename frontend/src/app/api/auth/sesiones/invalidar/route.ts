import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import {
  extractAccessToken,
  unauthorizedResponse,
  backendUrl,
  backendTimeout,
  parseJsonResponse,
  extractBackendErrorMessage,
  handleProxyError,
} from "@/lib/server/bff-helpers";

/**
 * POST /api/auth/sesiones/invalidar — "cerrar mis otras sesiones" (E01).
 *
 * AUTHENTICATED, unlike A4's public `/api/personas/instituciones` route:
 * this call needs the caller's own identity, resolved from the access-token
 * cookie (`extractAccessToken`) exactly like the other authenticated proxy
 * routes under `src/app/api/**` (e.g. `groups/asignar-alumno/route.ts`).
 *
 * Deliberately NOT `proxyToBackend` (the generic pass-through in
 * `bff-helpers.ts`): the backend response for this endpoint carries a fresh
 * `{ access_token, refresh_token, token_type }` pair (see
 * `AuthServicio.invalidar_otras_sesiones`), and `proxyToBackend` would relay
 * that JSON body verbatim to the browser — exactly the token-in-body leak
 * `src/lib/server/auth.ts`'s own docs forbid ("Tokens are never echoed into
 * the JSON body — only set as HttpOnly cookies"). Same shape problem
 * `api/auth/me/route.ts`'s `PATCH` already solves for a correo change: strip
 * the tokens, call `setAuthCookies` (reused from `api/auth/refresh/route.ts`),
 * and return a token-free body. The lower-level `bff-helpers.ts` primitives
 * (`backendUrl`, `backendTimeout`, `parseJsonResponse`, error shaping) are
 * still reused here — only the aggregate `proxyToBackend` is skipped.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const [controller, done] = backendTimeout();
  try {
    const response = await fetch(backendUrl("/auth/sesiones/invalidar"), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    const data = await parseJsonResponse(response);

    if (!response.ok) {
      return NextResponse.json(
        { message: extractBackendErrorMessage(data, response.status) },
        { status: response.status },
      );
    }

    if (!isTokenPairResponse(data)) {
      return NextResponse.json(
        { message: "El servidor respondió con una forma inesperada." },
        { status: 502 },
      );
    }

    const nextResponse = NextResponse.json(
      { mensaje: "Se cerraron sus otras sesiones. Este dispositivo sigue conectado." },
      { status: 200 },
    );
    setAuthCookies(nextResponse, { accessToken: data.access_token, refreshToken: data.refresh_token });
    return nextResponse;
  } catch (error: unknown) {
    return handleProxyError(error);
  } finally {
    done();
  }
}

interface BackendTokenPairResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

function isTokenPairResponse(value: unknown): value is BackendTokenPairResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access_token === "string" && v.access_token.length > 0 &&
    typeof v.refresh_token === "string" && v.refresh_token.length > 0
  );
}
