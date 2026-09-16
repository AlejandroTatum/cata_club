/**
 * Edge middleware — owns the strict Content-Security-Policy (issue #1069,
 * phase 3) and keeps the coarse, defense-in-depth guard for protected
 * sections.
 *
 * CSP: a fresh nonce is generated per request with Web Crypto (Edge-safe; a
 * nonce cannot be static at the edge, which is why Caddy emits no CSP at all
 * — two enforcing policies intersect and a static one would strip the nonce).
 * The policy is set BOTH on the request headers and the response headers:
 * Next.js 15 reads the CSP from the request and auto-applies the nonce to its
 * injected RSC/bootstrap `<script>` tags, so hydration stays alive under
 * `'strict-dynamic'`. Redirect responses (e.g. auth redirects) carry the CSP
 * too, so a blocked document is never served without the policy.
 *
 * Auth guard: per the auth integration plan (Phase 5): "Add coarse
 * server-side or middleware redirects for protected sections... Keep client
 * guards for UX transitions, not as the security boundary." This middleware
 * only blocks requests that have no plausible session cookie at all; it is
 * NOT where authorization decisions are made. The backend remains the
 * authority on every actual request, `ProtectedRoute`
 * (src/components/ProtectedRoute.tsx) still handles fine-grained role-based
 * redirects client-side, and /api/auth/session still does full,
 * server-validated session hydration.
 *
 * Deliberately does NOT decode or verify the JWT here — see the doc comment
 * on `hasPlausibleAccessToken` in src/lib/middleware-utils.ts for why.
 */

import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-cookies";
import {
  isProtectedPath,
  hasPendingActivation,
  hasPlausibleAccessToken,
  generateNonce,
  buildContentSecurityPolicy,
} from "@/lib/middleware-utils";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(nonce);

  // Next.js 15 reads this header from the request and stamps the nonce on its
  // own injected `<script>` tags.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response: NextResponse;
  if (isProtectedPath(pathname)) {
    const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    if (!hasPlausibleAccessToken(token)) {
      response = NextResponse.redirect(new URL("/login", request.url));
    } else if (hasPendingActivation(token)) {
      response = NextResponse.redirect(new URL("/login/activacion", request.url));
    } else {
      response = NextResponse.next({ request: { headers: requestHeaders } });
    }
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // All document routes, excluding Next's own static asset pipelines and
  // static files (the Next.js CSP/middleware pattern). Every document request
  // needs the per-request nonce; static assets do not execute scripts.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
