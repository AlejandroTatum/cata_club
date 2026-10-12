/**
 * #1653 — once the backend rotates the refresh token, a route that refreshes
 * and then forgets to write the cookies (an error branch, or a route that never
 * wrote them because the old refresh token kept working) strands the browser
 * with a stale refresh token. Its next refresh, past the 30 s grace window,
 * reads as reuse and revokes the session.
 *
 * So `backendFetchAuthed` persists the rotated pair itself, in the request's
 * cookie store (`next/headers`). Next merges those cookies into whatever
 * response the Route Handler returns, as fallbacks: a cookie the route sets
 * explicitly (for example the logout route clearing both) still wins.
 *
 * @vitest-environment node
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = { set: vi.fn() };
const cookiesMock = vi.fn(async () => jar);
vi.mock("next/headers", () => ({ cookies: () => cookiesMock() }));

import { backendFetchAuthed, refreshForRequest } from "../backend-client";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../auth";

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }));
  return `${header}.${payload}.signature`;
}

const TOKEN_VIGENTE = makeJwt(60 * 60);
const TOKEN_POR_VENCER = makeJwt(60);
const ACCESS_NUEVO = makeJwt(60 * 60);
const REFRESH_ROTADO = makeJwt(7 * 24 * 60 * 60);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function requestWith(access: string | undefined, refresh: string): NextRequest {
  const parts = [`${REFRESH_TOKEN_COOKIE}=${refresh}`];
  if (access) parts.push(`${ACCESS_TOKEN_COOKIE}=${access}`);
  return new NextRequest("http://localhost/api/galeria/1", { headers: { cookie: parts.join("; ") } });
}

function setCookieNames(): string[] {
  return jar.set.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  jar.set.mockReset();
  cookiesMock.mockReset();
  cookiesMock.mockImplementation(async () => jar);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("backendFetchAuthed persists the rotated pair in the request scope", () => {
  it("writes both cookies after a proactive refresh", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_NUEVO, refresh_token: REFRESH_ROTADO, token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await backendFetchAuthed(requestWith(TOKEN_POR_VENCER, "refresh-viejo"), "/galeria/1");

    expect(jar.set).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      ACCESS_NUEVO,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
    expect(jar.set).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      REFRESH_ROTADO,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });

  it("writes both cookies after the 401-retry refresh", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ detail: "expirado" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_NUEVO, refresh_token: REFRESH_ROTADO, token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await backendFetchAuthed(requestWith(TOKEN_VIGENTE, "refresh-viejo"), "/galeria/1");

    expect(setCookieNames()).toEqual([ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]);
  });

  it("still writes them when the backend call after the refresh fails (error branches)", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_NUEVO, refresh_token: REFRESH_ROTADO, token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ detail: "No encontrado" }, 404));

    const result = await backendFetchAuthed(requestWith(TOKEN_POR_VENCER, "refresh-viejo"), "/galeria/1");

    expect(result.ok && result.response.status).toBe(404);
    expect(setCookieNames()).toEqual([ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]);
  });

  it("writes only the access cookie when an old backend does not rotate", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_NUEVO, token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await backendFetchAuthed(requestWith(TOKEN_POR_VENCER, "refresh-viejo"), "/galeria/1");

    expect(setCookieNames()).toEqual([ACCESS_TOKEN_COOKIE]);
  });

  it("writes nothing when no refresh happened", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));

    await backendFetchAuthed(requestWith(TOKEN_VIGENTE, "refresh-viejo"), "/galeria/1");

    expect(jar.set).not.toHaveBeenCalled();
  });

  it("refreshes once per request even when the handler fans out concurrent calls", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) =>
      String(input).includes("/auth/refresh")
        ? jsonResponse({ access_token: ACCESS_NUEVO, refresh_token: REFRESH_ROTADO, token_type: "bearer" })
        : jsonResponse({ ok: true }),
    );
    const request = requestWith(TOKEN_POR_VENCER, "refresh-viejo");

    const [a, b] = await Promise.all([
      backendFetchAuthed(request, "/uno"),
      backendFetchAuthed(request, "/dos"),
    ]);
    const c = await backendFetchAuthed(request, "/tres");

    const refreshes = vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).includes("/auth/refresh"));
    expect(refreshes).toHaveLength(1);
    for (const result of [a, b, c]) {
      expect(result.ok && result.refreshedRefreshToken).toBe(REFRESH_ROTADO);
    }
  });

  it("does not share a refresh across different requests", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) =>
      String(input).includes("/auth/refresh")
        ? jsonResponse({ access_token: ACCESS_NUEVO, refresh_token: REFRESH_ROTADO, token_type: "bearer" })
        : jsonResponse({ ok: true }),
    );

    await backendFetchAuthed(requestWith(TOKEN_POR_VENCER, "refresh-a"), "/uno");
    await backendFetchAuthed(requestWith(TOKEN_POR_VENCER, "refresh-b"), "/uno");

    const refreshes = vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).includes("/auth/refresh"));
    expect(refreshes).toHaveLength(2);
  });

  it("refreshForRequest persists the pair even if the caller then fails (session route)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: ACCESS_NUEVO, refresh_token: REFRESH_ROTADO, token_type: "bearer" }),
    );

    const result = await refreshForRequest(requestWith(undefined, "refresh-viejo"), "refresh-viejo");

    expect(result.ok && result.data.refresh_token).toBe(REFRESH_ROTADO);
    expect(setCookieNames()).toEqual([ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]);
  });

  it("refreshForRequest writes nothing when the refresh fails", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Refresh token inválido" }, 401));

    const result = await refreshForRequest(requestWith(undefined, "refresh-viejo"), "refresh-viejo");

    expect(result.ok).toBe(false);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("keeps working outside a request scope (the cookie store is unavailable)", async () => {
    cookiesMock.mockImplementation(async () => {
      throw new Error("`cookies` was called outside a request scope.");
    });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: ACCESS_NUEVO, refresh_token: REFRESH_ROTADO, token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await backendFetchAuthed(requestWith(TOKEN_POR_VENCER, "refresh-viejo"), "/galeria/1");

    expect(result.ok && result.refreshedRefreshToken).toBe(REFRESH_ROTADO);
  });
});
