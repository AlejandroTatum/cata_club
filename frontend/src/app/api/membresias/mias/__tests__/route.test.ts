/** @vitest-environment node */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }));
  return `${header}.${payload}.sig`;
}

function request(cookie = "", query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/mias${query}`, { headers: cookie ? { cookie } : {} });
}

describe("GET /api/membresias/mias", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("does not call the backend without a session", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards an optional represented persona and preserves an opaque 403", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));
    const token = makeJwt(3600);
    const response = await GET(request(`${ACCESS_TOKEN_COOKIE}=${token}`, "?persona_id=9"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "No autorizado", mensaje_seguro: false });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/mias?persona_id=9",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${token}` }) }),
    );
  });

  it("returns memberships and rotates a refreshed access token", async () => {
    const expired = makeJwt(-1);
    const fresh = makeJwt(3600);
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: fresh, token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse([{ id: 4, personaId: 1 }]));
    const response = await GET(request(`${ACCESS_TOKEN_COOKIE}=${expired}; ${REFRESH_TOKEN_COOKIE}=refresh-token`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 4, personaId: 1 }]);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe(fresh);
  });
});
