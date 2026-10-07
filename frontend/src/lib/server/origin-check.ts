/**
 * Origin / Fetch-Metadata check for the BFF's mutating routes (#1653).
 *
 * Defense in depth on top of `SameSite=Lax` cookies: a state-changing request
 * to `/api/**` must come from the app's own origin. Pure and Edge-safe (no
 * Node APIs) because `src/middleware.ts` runs it before any route handler.
 *
 * Rules, for POST/PUT/PATCH/DELETE under `/api/`:
 *   1. `Origin` present  -> its host must equal the app's public host. The
 *      opaque `null` origin (sandboxed iframes, some redirects) never matches.
 *   2. `Origin` absent   -> browsers omit it on some same-origin requests, so
 *      fall back to `Sec-Fetch-Site`: `same-origin` and `none` (user-initiated)
 *      pass; `same-site` and `cross-site` are rejected. When the header is
 *      absent too, the caller is not a browser that sends Fetch Metadata
 *      (curl, server-to-server, very old browsers), and ambient cookies are
 *      already covered by `SameSite=Lax`, so it is allowed.
 *
 * The public host is `x-forwarded-host` (set by Caddy, the only public entry
 * point) or else `Host`. Only the host[:port] is compared, not the scheme:
 * the proxy terminates TLS, and the scheme adds no CSRF protection that the
 * host match does not already give.
 */

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Same-origin-by-design endpoints the origin rule must not gate. */
const EXEMPT_PATHS = new Set([
  // Written by the browser itself on CSP violations (Reporting API), not by
  // our pages, so Origin / Sec-Fetch-Site are not under our control. The
  // handler only logs; it has no session and changes no state.
  "/api/csp-report",
]);

export const FORBIDDEN_ORIGIN_BODY = {
  error: "forbidden_origin",
  message: "Origen de la solicitud no permitido.",
} as const;

function firstValue(header: string | null): string | null {
  const value = header?.split(",")[0]?.trim();
  return value ? value : null;
}

export function isOriginAllowed(request: {
  method: string;
  pathname: string;
  headers: Headers;
  /** Host of the request URL; used only when neither forwarded-host nor Host is present. */
  urlHost: string;
}): boolean {
  if (!request.pathname.startsWith("/api/")) return true;
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;
  if (EXEMPT_PATHS.has(request.pathname)) return true;

  const origin = request.headers.get("origin");
  if (origin !== null) {
    const publicHost =
      firstValue(request.headers.get("x-forwarded-host")) ??
      request.headers.get("host") ??
      request.urlHost;
    try {
      return new URL(origin).host === publicHost;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin" || fetchSite === "none";
}
