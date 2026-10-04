/**
 * Route Handler Tests — POST /api/attendance/correction-requests/[id]/approve
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.sig`;
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

function request(withCookie = true): NextRequest {
  return new NextRequest("http://localhost/api/attendance/correction-requests/4/approve", {
    method: "POST",
    headers: withCookie ? { cookie: `${ACCESS_TOKEN_COOKIE}=${makeJwt()}` } : {},
  });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/attendance/correction-requests/[id]/approve", () => {
  it("returns 401 without an access token", async () => {
    expect((await POST(request(false), context("4"))).status).toBe(401);
  });

  it("returns 400 for a bad id without calling the backend", async () => {
    expect((await POST(request(), context("abc"))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies the approval", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 4, estado: "APROBADA" }), { status: 200 }),
    );

    const response = await POST(request(), context("4"));

    expect(response.status).toBe(200);
    expect(String(vi.mocked(global.fetch).mock.calls[0][0])).toBe(
      "http://localhost:8000/api/v1/asistencias/solicitudes-correccion/4/aprobar",
    );
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
  });
});
