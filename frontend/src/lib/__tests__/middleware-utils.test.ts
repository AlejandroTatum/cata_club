/**
 * Unit tests for the pure logic behind middleware.ts (src/lib/middleware-utils.ts).
 *
 * middleware.ts itself (the NextRequest/NextResponse wrapper) is NOT covered
 * here — Next.js Edge middleware is awkward to exercise directly in vitest.
 * These tests cover everything the wrapper delegates to: which paths are
 * protected, and what counts as a plausible access-token cookie.
 */

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { isProtectedPath, hasPlausibleAccessToken, hasPendingActivation, generateNonce, buildContentSecurityPolicy } from "../middleware-utils";

// ---------------------------------------------------------------------------
// isProtectedPath
// ---------------------------------------------------------------------------

describe("isProtectedPath", () => {
  it("protects every known role-gated section", () => {
    const protectedPaths = [
      "/dashboard",
      "/dashboard/foo",
      "/attendance",
      "/trainer",
      "/trainer/attendance",
      // El padrón abre fichas de emergencia: si el guard grueso no la cubriera,
      // la pantalla se pediría sin cookie de sesión. El prefijo `/trainer` ya
      // la alcanza; queda asentado para que se note si alguien lo estrecha.
      "/trainer/students",
      "/groups",
      "/payments",
      "/members",
      "/student",
      "/unauthorized",
    ];
    for (const path of protectedPaths) {
      expect(isProtectedPath(path)).toBe(true);
    }
  });

  it("does not protect the public enrollment flow nested under /student", () => {
    expect(isProtectedPath("/student/enroll")).toBe(false);
    expect(isProtectedPath("/student/enroll/step-2")).toBe(false);
  });

  it("does not protect public/unauthenticated pages", () => {
    const publicPaths = ["/", "/login", "/forgot-password", "/profile", "/products"];
    for (const path of publicPaths) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it("does not false-positive on a path that merely starts with a protected prefix string", () => {
    // "/students" is a different route than "/student" — must not match via
    // naive string prefix.
    expect(isProtectedPath("/students")).toBe(false);
    expect(isProtectedPath("/dashboardish")).toBe(false);
  });
});

describe("hasPendingActivation", () => {
  it("recognizes an explicit pending activation claim", () => {
    const payload = btoa(JSON.stringify({ activacion_completa: false }));
    expect(hasPendingActivation(`header.${payload}.signature`)).toBe(true);
  });

  it("does not gate legacy tokens without the claim", () => {
    expect(hasPendingActivation("header.payload.signature")).toBe(false);
  });

  it("does not trust malformed payloads", () => {
    expect(hasPendingActivation("header.not-json.signature")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasPlausibleAccessToken
// ---------------------------------------------------------------------------

describe("hasPlausibleAccessToken", () => {
  it("accepts a syntactically plausible JWT (three non-empty dot-separated segments)", () => {
    expect(hasPlausibleAccessToken("header.payload.signature")).toBe(true);
  });

  it("rejects undefined/null/empty", () => {
    expect(hasPlausibleAccessToken(undefined)).toBe(false);
    expect(hasPlausibleAccessToken(null)).toBe(false);
    expect(hasPlausibleAccessToken("")).toBe(false);
  });

  it("rejects a value with the wrong number of segments", () => {
    expect(hasPlausibleAccessToken("only-one-segment")).toBe(false);
    expect(hasPlausibleAccessToken("two.segments")).toBe(false);
    expect(hasPlausibleAccessToken("a.b.c.d")).toBe(false);
  });

  it("rejects a value with an empty segment", () => {
    expect(hasPlausibleAccessToken("header..signature")).toBe(false);
    expect(hasPlausibleAccessToken(".payload.signature")).toBe(false);
  });

  it("does not verify signature or expiry — a garbage-but-3-segment string still passes (documented compromise)", () => {
    expect(hasPlausibleAccessToken("not.a.realtoken")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// middleware.ts — CSP emission (issue #1069, phase 3)
//
// The wrapper is exercised here with real NextRequest/NextResponse objects
// (next/server runs fine on Node's Web APIs); the CSP construction and nonce
// generation live in middleware-utils.ts above, so this only pins the wrapper's
// contract: every response carries the policy, each request gets a fresh nonce,
// and the auth redirects still behave exactly as before.
// ---------------------------------------------------------------------------

import { middleware } from "@/middleware";

function makeRequest(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(`https://cata.test${path}`), { headers });
}

describe("middleware CSP", () => {
  it("generates a different nonce per request", () => {
    const first = generateNonce();
    const second = generateNonce();
    expect(first).not.toEqual(second);
    expect(first).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("builds a strict policy carrying the nonce, strict-dynamic and the local report endpoint", () => {
    const csp = buildContentSecurityPolicy("ABC=");
    expect(csp).toContain("'nonce-ABC='");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("report-uri /api/csp-report");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  // Issue #1072: private vouchers and profile photos are delivered by the
  // expiring Cloudinary download endpoint (api.cloudinary.com), which the
  // backend returns for them and the UI renders inside <img>. Without this
  // host in img-src the browser blocks the image and the UI silently breaks.
  it("allows api.cloudinary.com in img-src for the expiring private-image endpoint", () => {
    const csp = buildContentSecurityPolicy("ABC=");
    const imgSrc = csp.split("; ").find((directive) => directive.startsWith("img-src "));
    expect(imgSrc).toBeDefined();
    expect(imgSrc).toContain("https://api.cloudinary.com");
    // The public CDN assets (e.g. sponsor logos) and the map tiles keep working.
    expect(imgSrc).toContain("https://res.cloudinary.com");
    expect(imgSrc).toContain("https://*.tile.openstreetmap.org");
  });

  it("sets Content-Security-Policy on plain next() responses for public paths", () => {
    const response = middleware(makeRequest("/"));
    expect(response.headers.get("Content-Security-Policy")).toContain("strict-dynamic");
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });

  it("uses a fresh nonce on every response", () => {
    const first = middleware(makeRequest("/")).headers.get("Content-Security-Policy") ?? "";
    const second = middleware(makeRequest("/")).headers.get("Content-Security-Policy") ?? "";
    expect(first).not.toEqual(second);
  });

  it("keeps the auth redirect to /login and still attaches the CSP to it", () => {
    const response = middleware(makeRequest("/dashboard"));
    expect(response.headers.get("location")).toBe("https://cata.test/login");
    expect(response.headers.get("Content-Security-Policy")).toContain("strict-dynamic");
  });

  it("keeps the pending-activation redirect and still attaches the CSP to it", () => {
    const payload = btoa(JSON.stringify({ activacion_completa: false }));
    const response = middleware(makeRequest("/dashboard", `access_token=header.${payload}.sig`));
    expect(response.headers.get("location")).toBe("https://cata.test/login/activacion");
    expect(response.headers.get("Content-Security-Policy")).toMatch(/'nonce-[^']+'/);
  });
});
