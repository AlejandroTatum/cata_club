/**
 * Unit tests for the pure logic behind middleware.ts (src/lib/middleware-utils.ts).
 *
 * middleware.ts itself (the NextRequest/NextResponse wrapper) is NOT covered
 * here — Next.js Edge middleware is awkward to exercise directly in vitest.
 * These tests cover everything the wrapper delegates to: which paths are
 * protected, and what counts as a plausible access-token cookie.
 */

import { describe, it, expect } from "vitest";
import { isProtectedPath, hasPlausibleAccessToken } from "../middleware-utils";

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
