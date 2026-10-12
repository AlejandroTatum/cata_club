/**
 * Tests for POST /api/auth/refresh.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../refresh/route";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function jwt(expOffsetSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expOffsetSeconds }),
  ).toString("base64url");
  return `h.${payload}.s`;
}

function refreshRequest(cookie: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/refresh", { method: "POST", headers: { cookie } });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/auth/refresh", () => {
  it("returns 401 with no fetch call when there is no refresh-token cookie", async () => {
    const response = await POST(refreshRequest(""));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sets a new access-token cookie and returns success (no token in body)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ access_token: "fresh-access", token_type: "bearer" }));

    const response = await POST(refreshRequest(`${REFRESH_TOKEN_COOKIE}=some-refresh-token`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(JSON.stringify(json)).not.toMatch(/fresh-access/);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("fresh-access");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.httpOnly).toBe(true);
  });

  it("persists the rotated refresh token in the same response as the new access token", async () => {
    const rotatedRefresh = jwt(7 * 24 * 60 * 60);
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "fresh-access", refresh_token: rotatedRefresh, token_type: "bearer" }),
    );

    const response = await POST(refreshRequest(`${REFRESH_TOKEN_COOKIE}=some-refresh-token`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(JSON.stringify(json)).not.toContain(rotatedRefresh);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("fresh-access");
    const refresh = response.cookies.get(REFRESH_TOKEN_COOKIE);
    expect(refresh?.value).toBe(rotatedRefresh);
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.maxAge).toBeGreaterThan(7 * 24 * 60 * 60 - 5);
    expect(refresh?.maxAge).toBeLessThanOrEqual(7 * 24 * 60 * 60);
  });

  it("does not set a new refresh-token cookie (backend doesn't return one)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ access_token: "fresh-access", token_type: "bearer" }));

    const response = await POST(refreshRequest(`${REFRESH_TOKEN_COOKIE}=some-refresh-token`));

    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });

  it("clears cookies and returns 401 when the refresh token is rejected", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}, 401));

    const response = await POST(refreshRequest(`${REFRESH_TOKEN_COOKIE}=expired-or-invalid`));

    expect(response.status).toBe(401);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("");
  });

  it("returns 503 without clearing cookies when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await POST(refreshRequest(`${REFRESH_TOKEN_COOKIE}=some-refresh-token`));

    expect(response.status).toBe(503);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });
});
