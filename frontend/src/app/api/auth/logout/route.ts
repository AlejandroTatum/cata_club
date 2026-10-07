import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  backendLogout,
  backendRefresh,
  clearAuthCookies,
  decodeJwtExpiry,
} from "@/lib/server/auth";

/** True only when the token's own `exp` says it is expired; an undecodable token is still worth trying. */
function isExpired(token: string): boolean {
  const exp = decodeJwtExpiry(token);
  return exp !== null && exp <= Math.floor(Date.now() / 1000);
}

/**
 * The access token to authenticate the upstream logout with: the cookie's own
 * when it is still usable, otherwise a fresh one minted from the refresh
 * cookie. Without that fallback, signing out after the 60-minute access token
 * lapsed cleared the cookies but left the refresh token valid for up to 7 days.
 */
async function accessTokenForLogout(request: NextRequest): Promise<string | undefined> {
  const accessCookie = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessCookie && !isExpired(accessCookie)) return accessCookie;

  const refreshCookie = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (refreshCookie) {
    const refreshed = await backendRefresh(refreshCookie);
    if (refreshed.ok) return refreshed.data.access_token;
  }
  // An expired access token cannot authenticate the revoke; nothing to call.
  return undefined;
}

/**
 * POST /api/auth/logout — best-effort upstream logout, always clears cookies.
 *
 * The backend logout revokes the session server-side: it bumps the user's
 * session epoch, which invalidates every access AND refresh token issued
 * before it. This route makes that call best-effort — when the access token
 * has expired it first refreshes with the refresh cookie so the revoke still
 * lands — and clears the cookies regardless of whether any upstream call
 * succeeds, throws, or times out.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const accessToken = await accessTokenForLogout(request);

  if (accessToken) {
    await backendLogout(accessToken);
  }

  const response = NextResponse.json({ success: true }, { status: 200 });
  clearAuthCookies(response);
  return response;
}
