/**
 * Tests for GET /api/auth/session.
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
 * Covers: returning the session for a valid access token, proactive refresh
 * when close to expiry, retry-then-clear when the access token is rejected,
 * and reporting unauthenticated (with cookies cleared) when refresh also
 * fails. A transient backend outage returns 503 without clearing cookies.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../session/route";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

function sessionRequest(cookie: string): NextRequest {
  return new NextRequest("http://localhost/api/auth/session", { headers: { cookie } });
}

const meBody = { correo: "admin@cataclub.com", personaId: 1, nombres: "Ana", apellidos: "Torres", roles: ["ADMINISTRADOR"] };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/auth/session", () => {
  it("returns 200 unauthenticated immediately when neither cookie is present (anonymous visitor, not an error)", async () => {
    const response = await GET(sessionRequest(""));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ authenticated: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns the session for a valid, non-expiring access token", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(meBody));

    const access = makeJwt(3600);
    const response = await GET(sessionRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.user.role).toBe("admin");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("proactively refreshes when the access token is close to expiry", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "refreshed-access", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse(meBody));

    const nearExpiryAccess = makeJwt(60); // under the 5-minute threshold
    const refresh = makeJwt(7 * 24 * 60 * 60);
    const response = await GET(
      sessionRequest(`${ACCESS_TOKEN_COOKIE}=${nearExpiryAccess}; ${REFRESH_TOKEN_COOKIE}=${refresh}`),
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/auth/refresh",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      }),
    );
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("refreshed-access");
  });

  it("attempts a refresh when the access token is missing but a refresh token is present", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "new-access", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse(meBody));

    const refresh = makeJwt(7 * 24 * 60 * 60);
    const response = await GET(sessionRequest(`${REFRESH_TOKEN_COOKIE}=${refresh}`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.user.email).toBe("admin@cataclub.com");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("new-access");
  });

  it("retries once via refresh when /auth/me rejects the access token, then succeeds", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({}, 401)) // /auth/me rejects
      .mockResolvedValueOnce(jsonResponse({ access_token: "rotated-access", token_type: "bearer" })) // refresh
      .mockResolvedValueOnce(jsonResponse(meBody)); // /auth/me retry succeeds

    const access = makeJwt(3600); // decodably "valid" but backend still says 401
    const refresh = makeJwt(7 * 24 * 60 * 60);
    const response = await GET(
      sessionRequest(`${ACCESS_TOKEN_COOKIE}=${access}; ${REFRESH_TOKEN_COOKIE}=${refresh}`),
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("rotated-access");
  });

  it("clears cookies and reports unauthenticated when refresh also fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({}, 401)) // /auth/me rejects
      .mockResolvedValueOnce(jsonResponse({}, 401)); // refresh also rejects

    const access = makeJwt(3600);
    const refresh = makeJwt(7 * 24 * 60 * 60);
    const response = await GET(
      sessionRequest(`${ACCESS_TOKEN_COOKIE}=${access}; ${REFRESH_TOKEN_COOKIE}=${refresh}`),
    );

    expect(response.status).toBe(401);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.maxAge).toBe(0);
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("");
  });

  it("clears cookies and reports unauthenticated when the access token is missing and refresh fails", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}, 401));

    const refresh = makeJwt(7 * 24 * 60 * 60);
    const response = await GET(sessionRequest(`${REFRESH_TOKEN_COOKIE}=${refresh}`));

    expect(response.status).toBe(401);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
  });

  it("returns 503 without clearing cookies on a transient backend outage", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const access = makeJwt(3600);
    const response = await GET(sessionRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(503);
    // No Set-Cookie should have been issued — cookies must survive a network blip.
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Issue #762 — a multi-role account has no session to hydrate.
  //
  // Unlike login, there is nobody reading a message here: this route answers a
  // background hydration call. It reports unauthenticated and clears the
  // cookies, so the next thing the person does is arrive at /login, where the
  // reason gets said out loud.
  // -------------------------------------------------------------------------

  it("reports unauthenticated when /auth/me still returns more than one role", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ ...meBody, roles: ["ADMINISTRADOR", "ENTRENADOR"] }),
    );

    const access = makeJwt(3600);
    const response = await GET(sessionRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.authenticated).toBe(false);
    expect(json).not.toHaveProperty("user");
  });

  it("clears the cookies of a multi-role account rather than leaving it half-signed-in", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ ...meBody, roles: ["ENTRENADOR", "REPRESENTANTE"] }),
    );

    const access = makeJwt(3600);
    const response = await GET(sessionRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("");
  });

  it("never includes a token anywhere in the JSON body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(meBody));

    const access = makeJwt(3600);
    const response = await GET(sessionRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const json = await response.json();

    expect(JSON.stringify(json)).not.toMatch(/token/i);
  });
});
