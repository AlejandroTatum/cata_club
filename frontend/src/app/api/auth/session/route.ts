import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  backendMe,
  backendRefresh,
  buildSession,
  clearAuthCookies,
  hasPendingActivationToken,
  isNearExpiry,
  setAuthCookies,
} from "@/lib/server/auth";

/** Refresh proactively once the access token has under 5 minutes left — well inside its 60-minute lifetime. */
const PROACTIVE_REFRESH_THRESHOLD_SECONDS = 5 * 60;

/**
 * GET /api/auth/session — hydrate the browser's auth state.
 *
 * Always re-derives the session from /auth/me (roles can change server-side)
 * rather than trusting a stale local claim. If the access token is missing
 * or close to expiry, attempts a refresh first; if refresh also fails,
 * clears cookies and reports unauthenticated. A transient backend outage
 * (unrelated to the token itself) returns 503 without clearing cookies, so
 * a network blip doesn't silently log the user out.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const accessCookie = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshCookie = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!accessCookie && !refreshCookie) {
    // No cookies at all is the expected state for an anonymous visitor on a
    // public page (landing, login, register) — every one of those calls this
    // route on mount. Reporting it as a 401 error floods the console on every
    // public-page load; there's no invalid/expired token here to complain
    // about, so this is a normal 200 result, not an error.
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  let activeAccessToken = accessCookie;
  let refreshedAccessToken: string | undefined;

  const needsProactiveRefresh =
    activeAccessToken !== undefined && isNearExpiry(activeAccessToken, PROACTIVE_REFRESH_THRESHOLD_SECONDS);

  if ((!activeAccessToken || needsProactiveRefresh) && refreshCookie) {
    const refreshResult = await backendRefresh(refreshCookie);
    if (refreshResult.ok) {
      refreshedAccessToken = refreshResult.data.access_token;
      activeAccessToken = refreshedAccessToken;
    } else if (!activeAccessToken) {
      // No access token at all and the refresh attempt failed too.
      if (refreshResult.error.code === "backend_unavailable" || refreshResult.error.code === "timeout") {
        return NextResponse.json({ authenticated: false, error: refreshResult.error.code }, { status: 503 });
      }
      const response = NextResponse.json({ authenticated: false }, { status: 401 });
      clearAuthCookies(response);
      return response;
    }
    // else: proactive refresh failed but we still have a (soon-to-expire)
    // access token — fall through and try it; the retry path below clears
    // the session if /auth/me also rejects it.
  }

  if (!activeAccessToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  let meResult = await backendMe(activeAccessToken);

  if (!meResult.ok && meResult.error.code === "unauthorized" && refreshCookie && !refreshedAccessToken) {
    const refreshResult = await backendRefresh(refreshCookie);
    if (refreshResult.ok) {
      refreshedAccessToken = refreshResult.data.access_token;
      meResult = await backendMe(refreshedAccessToken);
    }
  }

  if (!meResult.ok) {
    if (meResult.error.code === "backend_unavailable" || meResult.error.code === "timeout") {
      return NextResponse.json({ authenticated: false, error: meResult.error.code }, { status: 503 });
    }
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  const built = buildSession(meResult.data);
  if (!built.ok) {
    // Issue #762: the account still holds more than one active role, so there
    // is no session to hydrate. Reported as unauthenticated with the cookies
    // cleared — not as a 503, which would be read as a blip worth retrying,
    // and not as a session with a role guessed for it.
    //
    // Nobody is reading a message here; this route answers a background
    // hydration call. Clearing the cookies is what routes the person to
    // /login, which is where POST /api/auth/login says the reason out loud.
    const refusal = NextResponse.json(
      { authenticated: false, error: "role_conflict" },
      { status: 401 },
    );
    clearAuthCookies(refusal);
    return refusal;
  }

  // A pending token may become complete after the club activates a
  // membership. Refresh once the authoritative `/auth/me` answer says the
  // hito is complete, so the Edge guard receives the new coarse hint too.
  if (
    !refreshedAccessToken &&
    activeAccessToken &&
    hasPendingActivationToken(activeAccessToken) &&
    built.session.correoVerificado &&
    built.session.altaPresencialCompletada &&
    refreshCookie
  ) {
    const refreshResult = await backendRefresh(refreshCookie);
    if (refreshResult.ok) refreshedAccessToken = refreshResult.data.access_token;
  }

  const response = NextResponse.json(built.session, { status: 200 });
  if (refreshedAccessToken) {
    setAuthCookies(response, { accessToken: refreshedAccessToken });
  }
  return response;
}
