/**
 * Tests for POST /api/auth/logout.
 *
 * Core requirement: cookies are ALWAYS cleared, even when the upstream
 * FastAPI logout call throws/errors/times out — client-side cookie
 * clearing is authoritative. The backend logout DOES revoke the session
 * (it bumps the per-user session epoch), so an expired access token must not
 * leave the refresh token alive: the route refreshes first (#1653).
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../logout/route";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/server/auth";

function jwt(expOffsetSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expOffsetSeconds }),
  ).toString("base64url");
  return `h.${payload}.s`;
}

function calls(): Array<{ url: string; auth: string | null }> {
  return vi.mocked(global.fetch).mock.calls.map(([url, init]) => ({
    url: String(url),
    auth: new Headers((init as RequestInit).headers).get("authorization"),
  }));
}

function logoutRequest(cookie: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/logout", { method: "POST", headers: { cookie } });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/auth/logout", () => {
  it("clears both cookies and returns success when the upstream call succeeds", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    const response = await POST(logoutRequest(`${ACCESS_TOKEN_COOKIE}=some-access-token`));
    const json = await response.json();

    expect(json).toEqual({ success: true });
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("");
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.maxAge).toBe(0);
  });

  it("still clears both cookies and returns success when the upstream call throws", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("network down"));

    const response = await POST(logoutRequest(`${ACCESS_TOKEN_COOKIE}=some-access-token`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("");
  });

  it("still clears both cookies and returns success when the upstream call rejects (e.g. 500)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));

    const response = await POST(logoutRequest(`${ACCESS_TOKEN_COOKIE}=some-access-token`));

    expect(response.status).toBe(200);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
  });

  it("clears cookies and does not call the backend when there is no access-token cookie", async () => {
    const response = await POST(logoutRequest(""));
    const json = await response.json();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(json).toEqual({ success: true });
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("");
  });

  it("revokes with the access token when it is still valid, without refreshing", async () => {
    const access = jwt(600);
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));

    await POST(logoutRequest(`${ACCESS_TOKEN_COOKIE}=${access}; ${REFRESH_TOKEN_COOKIE}=${jwt(9999)}`));

    expect(calls()).toEqual([{ url: "http://localhost:8000/api/v1/auth/logout", auth: `Bearer ${access}` }]);
  });

  it("refreshes first and revokes with the new access token when the access token is expired", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(Response.json({ access_token: "fresh-access", token_type: "bearer" }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const response = await POST(
      logoutRequest(`${ACCESS_TOKEN_COOKIE}=${jwt(-60)}; ${REFRESH_TOKEN_COOKIE}=refresh-token`),
    );

    expect(calls()).toEqual([
      { url: "http://localhost:8000/api/v1/auth/refresh", auth: null },
      { url: "http://localhost:8000/api/v1/auth/logout", auth: "Bearer fresh-access" },
    ]);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.maxAge).toBe(0);
  });

  it("refreshes and revokes when the access cookie is already gone but the refresh cookie remains", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(Response.json({ access_token: "fresh-access", token_type: "bearer" }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await POST(logoutRequest(`${REFRESH_TOKEN_COOKIE}=refresh-token`));

    expect(calls().map((c) => c.url)).toEqual([
      "http://localhost:8000/api/v1/auth/refresh",
      "http://localhost:8000/api/v1/auth/logout",
    ]);
  });

  it("clears cookies and returns success when the expired session can no longer be refreshed", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));

    const response = await POST(
      logoutRequest(`${ACCESS_TOKEN_COOKIE}=${jwt(-60)}; ${REFRESH_TOKEN_COOKIE}=dead-refresh`),
    );

    expect(calls().map((c) => c.url)).toEqual(["http://localhost:8000/api/v1/auth/refresh"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.maxAge).toBe(0);
  });

  it("still clears cookies when the refresh fallback throws (e.g. BACKEND_API_URL unset)", async () => {
    delete process.env.BACKEND_API_URL;

    const response = await POST(
      logoutRequest(`${ACCESS_TOKEN_COOKIE}=${jwt(-60)}; ${REFRESH_TOKEN_COOKIE}=refresh-token`),
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.maxAge).toBe(0);
  });
});
