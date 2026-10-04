/**
 * Route Handler Tests — GET /api/membresias/coberturas/todas (admin review)
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${header}.${base64Url(JSON.stringify({ sub: "1", exp }))}.${base64Url("sig")}`;
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/membresias/coberturas/todas", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const res = await GET(new NextRequest("http://localhost/api/membresias/coberturas/todas"));
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards pagination and passes the body through", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0, skip: 0, limit: 50 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await GET(
      new NextRequest("http://localhost/api/membresias/coberturas/todas?skip=0&limit=50", {
        headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], total: 0, skip: 0, limit: 50 });
    const [url] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/coberturas/todas?skip=0&limit=50");
  });
});
