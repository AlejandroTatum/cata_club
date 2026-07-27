/**
 * Authenticated backend proxy — the shared primitive every protected
 * resource's Route Handler (payments, asistencias, personas, ranking, ...)
 * uses to call FastAPI with a valid `Authorization: Bearer` header.
 *
 * Mirrors the token-resolution and refresh-and-retry dance already
 * established in `src/app/api/auth/session/route.ts`, factored out so it
 * isn't reimplemented per resource. Like the rest of `src/lib/server/**`,
 * this is server-only — import it only from Route Handlers.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  backendFetch,
  backendRefresh,
  isNearExpiry,
  setAuthCookies,
  type AuthErrorCode,
} from "@/lib/server/auth";

/** Same threshold used by /api/auth/session — refresh proactively with 5 minutes left. */
const PROACTIVE_REFRESH_THRESHOLD_SECONDS = 5 * 60;

interface ResolvedToken {
  token: string;
  /** Set when this resolution itself refreshed the token — skips a redundant retry-refresh below. */
  refreshedAccessToken?: string;
}

/** Resolve a usable access token from cookies, refreshing first if missing or near expiry. Null when unrecoverable. */
async function resolveAccessToken(request: NextRequest): Promise<ResolvedToken | null> {
  const accessCookie = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshCookie = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!accessCookie && !refreshCookie) return null;

  const needsRefresh = accessCookie !== undefined && isNearExpiry(accessCookie, PROACTIVE_REFRESH_THRESHOLD_SECONDS);

  if ((!accessCookie || needsRefresh) && refreshCookie) {
    const refreshResult = await backendRefresh(refreshCookie);
    if (refreshResult.ok) {
      return { token: refreshResult.data.access_token, refreshedAccessToken: refreshResult.data.access_token };
    }
    if (!accessCookie) return null;
    // Proactive refresh failed but the current token might still be valid for a bit longer — try it as-is.
  }

  return accessCookie ? { token: accessCookie } : null;
}

export type BackendProxyResult =
  | { ok: true; response: Response; refreshedAccessToken?: string }
  | { ok: false; status: number; error: AuthErrorCode };

const STATUS_BY_ERROR: Record<AuthErrorCode, number> = {
  invalid_credentials: 401,
  // See the note in src/app/api/auth/login/route.ts — a misconfigured server
  // is a 500, so nothing downstream retries a permanently broken request.
  config_error: 500,
  backend_unavailable: 503,
  timeout: 503,
  invalid_response: 502,
  unauthorized: 401,
  unknown: 500,
};

/**
 * Authenticated proxy fetch to FastAPI. Reads the access-token cookie off
 * `request` (refreshing it first if missing/near expiry), attaches
 * `Authorization: Bearer`, and — if the backend still answers 401 with an
 * unrefreshed token — refreshes once more and retries exactly once (mirrors
 * the retry in `/api/auth/session`). Returns the raw `Response` so callers
 * decide how to shape their own `NextResponse` (passthrough JSON, or
 * translate the DTO into a frontend-specific shape).
 *
 * Callers that receive `refreshedAccessToken` MUST call `setAuthCookies`
 * (from `src/lib/server/auth.ts`) on their own `NextResponse` before
 * returning, or the refreshed token is silently dropped on this request.
 */
export async function backendFetchAuthed(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
): Promise<BackendProxyResult> {
  const resolved = await resolveAccessToken(request);
  if (!resolved) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const attempt = (token: string) =>
    backendFetch(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });

  let result = await attempt(resolved.token);
  let refreshedAccessToken = resolved.refreshedAccessToken;

  if (result.ok && result.data.status === 401 && !refreshedAccessToken) {
    const refreshCookie = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    if (refreshCookie) {
      const refreshResult = await backendRefresh(refreshCookie);
      if (refreshResult.ok) {
        refreshedAccessToken = refreshResult.data.access_token;
        result = await attempt(refreshedAccessToken);
      }
    }
  }

  if (!result.ok) {
    return { ok: false, status: STATUS_BY_ERROR[result.error.code], error: result.error.code };
  }

  return { ok: true, response: result.data, refreshedAccessToken };
}

/**
 * Relay a non-OK backend `Response` as a `NextResponse` with the same
 * status, extracting whatever user-facing message the backend sent
 * (`message` or FastAPI's `detail`) instead of leaking the raw body. Shared
 * across every resource's Route Handler under `src/app/api/**` that proxies
 * `backendFetchAuthed` — one place to fix if the backend's error shape ever
 * changes.
 */
export async function passthroughBackendError(response: Response, fallback: string): Promise<NextResponse> {
  let message = fallback;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const b = body as Record<string, unknown>;
      message = (typeof b.message === "string" && b.message) || (typeof b.detail === "string" && b.detail) || fallback;
    }
  } catch {
    // ignore parse errors — use fallback
  }
  return NextResponse.json({ message }, { status: response.status });
}

/**
 * Shared `GET` proxy for the common case: authenticate, relay the backend's
 * JSON body as-is, pass through backend/HTTP errors, and forward a refreshed
 * access-token cookie. Extracted so simple passthrough routes don't
 * reimplement this same sequence per resource.
 */
export async function proxyBackendGet(request: NextRequest, path: string, errorMessage: string): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, path);
  if (!result.ok) {
    return NextResponse.json({ message: errorMessage }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, errorMessage);
  }
  const response = NextResponse.json(await result.response.json());
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}

/**
 * Shared `GET` proxy for binary PDF report exports: authenticate, relay
 * backend/HTTP errors the same way `proxyBackendGet` does, then stream the
 * raw PDF bytes back with `Content-Type: application/pdf` and whatever
 * `Content-Disposition` FastAPI sent (falling back to `attachment` if
 * absent). Extracted so the report PDF routes under `src/app/api/` don't
 * each reimplement this same arrayBuffer-then-NextResponse tail.
 */
export async function proxyBackendPdfGet(request: NextRequest, path: string, errorMessage: string): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, path);
  if (!result.ok) {
    return NextResponse.json({ message: errorMessage }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, errorMessage);
  }

  const bytes = await result.response.arrayBuffer();
  const response = new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": result.response.headers.get("Content-Disposition") ?? "attachment",
    },
  });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
