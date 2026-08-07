/**
 * Pure logic behind middleware.ts — extracted so it's unit-testable without
 * mocking Next.js's NextRequest/NextResponse (Edge middleware is otherwise
 * awkward to exercise directly in vitest).
 *
 * This is intentionally a COARSE guard, not the security boundary — see the
 * doc comment on ProtectedRoute (src/components/ProtectedRoute.tsx) and the
 * auth integration plan. It only checks for the presence and rough shape of
 * the access-token cookie; it does NOT verify the JWT signature or decode
 * its expiry. Full validation happens server-side in
 * src/app/api/auth/session/route.ts, and the backend is always the actual
 * authorization authority. This file must stay free of Node-only APIs
 * (no `Buffer`, no server-only fetch helpers) so it can run in the Edge
 * runtime.
 */

/**
 * Path prefixes that require *some* plausible session before the request is
 * even allowed to reach the page. Keep in sync with every `ProtectedRoute`
 * usage under src/app/**.
 */
export const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/attendance",
  "/trainer",
  "/groups",
  "/payments",
  "/members",
  "/student",
  "/unauthorized",
] as const;

/**
 * Paths nested under a protected prefix that must stay reachable without a
 * session. `/student/enroll` is the public enrollment flow — it lives under
 * `/student` but intentionally has no `ProtectedRoute` wrapper.
 */
const PUBLIC_EXCEPTIONS = ["/student/enroll"] as const;

function pathMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * True when `pathname` falls under a protected prefix and isn't one of the
 * explicit public exceptions nested inside it.
 */
export function isProtectedPath(pathname: string): boolean {
  if (PUBLIC_EXCEPTIONS.some((exception) => pathMatches(pathname, exception))) {
    return false;
  }
  return PROTECTED_PATH_PREFIXES.some((prefix) => pathMatches(pathname, prefix));
}

/**
 * Light presence/format check for the access-token cookie value — three
 * dot-separated, non-empty segments (a syntactically plausible JWT).
 *
 * Deliberately NOT a signature or expiry check: doing that correctly would
 * mean either importing server-only JWT-decoding logic into the Edge
 * runtime (src/lib/server/auth.ts uses `Buffer`, unavailable there) or
 * adding a new JWT verification dependency — out of scope for a coarse
 * guard. A forged or expired token that passes this check is still caught
 * by /api/auth/session, which the client hydrates from immediately and
 * which does full server-side validation against the backend.
 */
export function hasPlausibleAccessToken(cookieValue: string | undefined | null): boolean {
  if (!cookieValue) return false;
  const segments = cookieValue.split(".");
  return segments.length === 3 && segments.every((segment) => segment.length > 0);
}
