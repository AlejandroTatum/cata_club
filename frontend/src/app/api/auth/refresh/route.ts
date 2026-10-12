import { NextRequest, NextResponse } from "next/server";
import { REFRESH_TOKEN_COOKIE, backendRefresh, clearAuthCookies, setAuthCookies } from "@/lib/server/auth";

/**
 * POST /api/auth/refresh — rotate the access token cookie and, when the
 * backend rotates it, the refresh token cookie.
 *
 * Used both by GET /api/auth/session (proactive/retry refresh) and by the
 * generic API client's 401-retry path (src/services/api.ts). Never returns
 * a token in the body — only sets the refreshed cookies. The backend rotates
 * the refresh token on every use, so both cookies are set in this one
 * response; an older backend that omits `refresh_token` leaves the existing
 * refresh cookie untouched.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshCookie = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshCookie) {
    return NextResponse.json({ error: "no_refresh_token", message: "No hay sesión que renovar." }, { status: 401 });
  }

  const result = await backendRefresh(refreshCookie);
  if (!result.ok) {
    if (result.error.code === "backend_unavailable" || result.error.code === "timeout") {
      return NextResponse.json({ error: result.error.code, message: result.error.message }, { status: 503 });
    }
    const response = NextResponse.json({ error: result.error.code, message: result.error.message }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  const response = NextResponse.json({ success: true }, { status: 200 });
  setAuthCookies(response, { accessToken: result.data.access_token, refreshToken: result.data.refresh_token });
  return response;
}
