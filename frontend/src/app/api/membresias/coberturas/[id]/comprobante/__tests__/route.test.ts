/**
 * Route Handler Tests — GET /api/membresias/coberturas/:id/comprobante
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

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/membresias/coberturas/4/comprobante", {
    headers: cookie ? { cookie } : {},
  });
}

const props = { params: Promise.resolve({ id: "4" }) };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/membresias/coberturas/:id/comprobante", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const res = await GET(getRequest(), props);
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies the receipt PDF from the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response("%PDF-1.4", {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="r.pdf"' },
      }),
    );
    const res = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`), props);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="r.pdf"');
    const [url] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/coberturas/4/comprobante");
  });

  it("passes a backend 403 through", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "no" }), { status: 403, headers: { "Content-Type": "application/json" } }),
    );
    const res = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`), props);
    expect(res.status).toBe(403);
  });
});
