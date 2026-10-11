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

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  BACKEND_TIMEOUT_MS,
  PDF_BACKEND_TIMEOUT_MS,
  REFRESH_TOKEN_COOKIE,
  backendFetch,
  backendRefresh,
  isNearExpiry,
  refreshedTokenCookies,
  setAuthCookies,
  writeAuthCookies,
  type AuthErrorCode,
  type BackendFetchOptions,
} from "@/lib/server/auth";

/** Same threshold used by /api/auth/session — refresh proactively with 5 minutes left. */
const PROACTIVE_REFRESH_THRESHOLD_SECONDS = 5 * 60;

interface ResolvedToken {
  token: string;
  /** Set when this resolution itself refreshed the token — skips a redundant retry-refresh below. */
  refreshedAccessToken?: string;
  /** The rotated refresh token that came with `refreshedAccessToken`; absent if the backend did not rotate. */
  refreshedRefreshToken?: string;
}

/** Resolve a usable access token from cookies, refreshing first if missing or near expiry. Null when unrecoverable. */
function remainingTimeout(deadline: number): BackendFetchOptions {
  return { timeoutMs: Math.max(0, deadline - Date.now()) };
}

async function resolveAccessToken(request: NextRequest, deadline: number): Promise<ResolvedToken | null> {
  const accessCookie = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshCookie = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!accessCookie && !refreshCookie) return null;

  const needsRefresh = accessCookie !== undefined && isNearExpiry(accessCookie, PROACTIVE_REFRESH_THRESHOLD_SECONDS);

  if ((!accessCookie || needsRefresh) && refreshCookie) {
    const refreshResult = await refreshForRequest(request, refreshCookie, remainingTimeout(deadline));
    if (refreshResult.ok) {
      return {
        token: refreshResult.data.access_token,
        refreshedAccessToken: refreshResult.data.access_token,
        refreshedRefreshToken: refreshResult.data.refresh_token,
      };
    }
    if (!accessCookie) return null;
    // Proactive refresh failed but the current token might still be valid for a bit longer — try it as-is.
  }

  return accessCookie ? { token: accessCookie } : null;
}

export type BackendProxyResult =
  | { ok: true; response: Response; refreshedAccessToken?: string; refreshedRefreshToken?: string }
  | { ok: false; status: number; error: AuthErrorCode };

const STATUS_BY_ERROR: Record<AuthErrorCode, number> = {
  invalid_credentials: 401,
  account_inactive: 403,
  login_cooldown: 429,
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
 * A refreshed pair is persisted in the request's cookie store here (see
 * `persistInRequestScope`), so every branch of every Route Handler carries it,
 * error branches included. Callers that build their own `NextResponse` still
 * write it explicitly with `setAuthCookies(response, refreshedTokenCookies(result))`:
 * that keeps the cookies on responses produced outside Next's request scope
 * and documents the intent at the call site.
 *
 * `options.timeoutMs` is one absolute budget for this complete authenticated
 * operation: token resolution, the first resource attempt, refresh after a
 * 401, and the retry. Each backend call receives only the time remaining, so
 * a retry can never receive a fresh budget. Callers without an override keep
 * the 10-second default.
 */
export async function backendFetchAuthed(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
  options: BackendFetchOptions = {},
): Promise<BackendProxyResult> {
  const timeoutMs = options.timeoutMs ?? BACKEND_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const resolved = await resolveAccessToken(request, deadline);
  if (!resolved) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const attempt = (token: string) =>
    backendFetch(
      path,
      { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } },
      remainingTimeout(deadline),
    );

  let result = await attempt(resolved.token);
  let refreshedAccessToken = resolved.refreshedAccessToken;
  let refreshedRefreshToken = resolved.refreshedRefreshToken;

  if (result.ok && result.data.status === 401 && !refreshedAccessToken) {
    const refreshCookie = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
    if (refreshCookie) {
      const refreshResult = await refreshForRequest(request, refreshCookie, remainingTimeout(deadline));
      if (refreshResult.ok) {
        refreshedAccessToken = refreshResult.data.access_token;
        refreshedRefreshToken = refreshResult.data.refresh_token;
        result = await attempt(refreshedAccessToken);
      }
    }
  }

  if (!result.ok) {
    return { ok: false, status: STATUS_BY_ERROR[result.error.code], error: result.error.code };
  }

  return { ok: true, response: result.data, refreshedAccessToken, refreshedRefreshToken };
}

type RefreshResult = Awaited<ReturnType<typeof backendRefresh>>;

/** One refresh per incoming request (see `refreshForRequest`). */
const refreshesByRequest = new WeakMap<NextRequest, Promise<RefreshResult>>();

/**
 * #1653: the ONE way a Route Handler refreshes. Memoized per incoming request,
 * so every `backendFetchAuthed` of a handler -- concurrent fan-outs and long
 * paginated drains alike -- shares a single backend refresh instead of each
 * replaying the old refresh cookie (one DB write each, and past the backend's
 * 30 s grace window a later replay reads as reuse and revokes the session).
 * A successful refresh is persisted into the request's cookie store at once,
 * so the rotated pair survives whatever the caller answers next.
 */
export function refreshForRequest(
  request: NextRequest,
  refreshCookie: string,
  options: BackendFetchOptions = {},
): Promise<RefreshResult> {
  let pending = refreshesByRequest.get(request);
  if (!pending) {
    pending = backendRefresh(refreshCookie, options).then(async (result) => {
      if (result.ok) {
        await persistInRequestScope({ accessToken: result.data.access_token, refreshToken: result.data.refresh_token });
      }
      return result;
    });
    refreshesByRequest.set(request, pending);
  }
  return pending;
}

/**
 * #1653: write a refreshed pair into the request's cookie store, whatever the
 * caller does next. The refresh token rotates on every use, so a route that
 * refreshes and then answers without the cookies (an error branch, or a route
 * that never wrote them) would strand the browser with a stale refresh token;
 * its next refresh, past the backend's 30 s grace window, reads as reuse and
 * revokes the session. Next merges this store into the Route Handler's
 * response as fallbacks, so a cookie the route sets itself still wins (the
 * logout route clearing both, for one). Outside a request scope there is no
 * store to write to; the caller's explicit `setAuthCookies` still applies.
 */
async function persistInRequestScope(tokens: { accessToken: string; refreshToken?: string }): Promise<void> {
  try {
    writeAuthCookies(await cookies(), tokens);
  } catch {
    // Not in a Route Handler (unit tests, scripts): nothing to persist into.
  }
}

/**
 * Relay a non-OK backend `Response` as a `NextResponse` with the same
 * status, extracting whatever user-facing message the backend sent
 * (`message` or FastAPI's `detail`) instead of leaking the raw body. Shared
 * across every resource's Route Handler under `src/app/api/**` that proxies
 * `backendFetchAuthed` — one place to fix if the backend's error shape ever
 * changes.
 *
 * Also forwards `mensaje_seguro` (issue #481): the backend marks a 5xx
 * `detail` safe to show as-is via `ErrorDominio.seguro_mostrar` (see
 * `error-message.ts`'s "5xx exception"), but that marker lived only in
 * FastAPI's response body — this helper dropped it, so `services/api.ts`
 * always saw `mensaje_seguro` as absent and every BFF-proxied 5xx fell back
 * to the generic `SERVER_FAILURE` copy regardless of what the backend sent.
 * Defaults to `false`, same fail-closed behavior as the message fallback.
 */
export async function passthroughBackendError(response: Response, fallback: string): Promise<NextResponse> {
  let message = fallback;
  let mensajeSeguro = false;
  let validationLoc: string[] | undefined;
  let membresiaId: number | undefined;
  let codigo: string | undefined;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const b = body as Record<string, unknown>;
      message = (typeof b.message === "string" && b.message) || (typeof b.detail === "string" && b.detail) || fallback;
      mensajeSeguro = b.mensaje_seguro === true;
      // QA3 ADM-08: the id of the existing membership, so the UI can link to it.
      if (typeof b.membresia_id === "number") membresiaId = b.membresia_id;
      // Machine-readable reason (e.g. `reaceptacion_legal_pendiente`) so the browser can react to it.
      if (typeof b.codigo === "string") codigo = b.codigo;
      if (response.status === 422 && Array.isArray(b.detail)) {
        const first = b.detail[0];
        if (typeof first === "object" && first !== null && Array.isArray((first as Record<string, unknown>).loc)) {
          const loc = (first as Record<string, unknown>).loc as unknown[];
          const stringLoc = loc.filter((part): part is string => typeof part === "string");
          if (stringLoc.length === loc.length) validationLoc = stringLoc;
        }
      }
    }
  } catch {
    // ignore parse errors — use fallback
  }
  return NextResponse.json({
    message,
    mensaje_seguro: mensajeSeguro,
    ...(validationLoc ? { validation_loc: validationLoc } : {}),
    ...(membresiaId !== undefined ? { membresia_id: membresiaId } : {}),
    ...(codigo !== undefined ? { codigo } : {}),
  }, { status: response.status, headers: response.headers.get("X-Request-ID") ? { "X-Request-ID": response.headers.get("X-Request-ID")! } : {} });
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
    setAuthCookies(response, refreshedTokenCookies(result));
  }
  return response;
}

/**
 * Authenticated JSON GET proxy: forwards `path` to the backend, passes a
 * successful body through untouched and maps failures to `errorMessage`.
 * Rotates the access-token cookie when the backend client refreshed it.
 */
export async function proxyBackendJsonGet(request: NextRequest, path: string, errorMessage: string): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, path);
  if (!result.ok) {
    return NextResponse.json({ message: errorMessage }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, errorMessage);
  }

  const response = NextResponse.json(await result.response.json());
  if (result.refreshedAccessToken) {
    setAuthCookies(response, refreshedTokenCookies(result));
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
 *
 * This is the one caller that overrides the backend deadline: generating a
 * report is not authenticating, so it gets `PDF_BACKEND_TIMEOUT_MS` instead
 * of the auth-sized default (issue #197).
 */
export async function proxyBackendPdfGet(request: NextRequest, path: string, errorMessage: string): Promise<NextResponse> {
  const result = await backendFetchAuthed(request, path, {}, { timeoutMs: PDF_BACKEND_TIMEOUT_MS });
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
    setAuthCookies(response, refreshedTokenCookies(result));
  }
  return response;
}
