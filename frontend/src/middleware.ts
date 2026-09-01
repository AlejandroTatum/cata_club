/**
 * Edge middleware — coarse, defense-in-depth guard for protected sections.
 *
 * Per the auth integration plan (Phase 5): "Add coarse server-side or
 * middleware redirects for protected sections... Keep client guards for UX
 * transitions, not as the security boundary." This middleware only blocks
 * requests that have no plausible session cookie at all; it is NOT where
 * authorization decisions are made. The backend remains the authority on
 * every actual request, `ProtectedRoute` (src/components/ProtectedRoute.tsx)
 * still handles fine-grained role-based redirects client-side, and
 * /api/auth/session still does full, server-validated session hydration.
 *
 * Deliberately does NOT decode or verify the JWT here — see the doc comment
 * on `hasPlausibleAccessToken` in src/lib/middleware-utils.ts for why.
 */

import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-cookies";
import { isProtectedPath, hasPendingActivation, hasPlausibleAccessToken } from "@/lib/middleware-utils";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!hasPlausibleAccessToken(token)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (hasPendingActivation(token)) {
    return NextResponse.redirect(new URL("/login/activacion", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/attendance/:path*",
    "/trainer/:path*",
    "/groups/:path*",
    "/payments/:path*",
    "/members/:path*",
    "/student/:path*",
    "/unauthorized/:path*",
  ],
};
