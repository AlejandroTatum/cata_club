/**
 * Route Handler Tests — POST /api/attendance/correction-requests/[id]/reject
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

function request(body: unknown, withCookie = true): NextRequest {
  return new NextRequest("http://localhost/api/attendance/correction-requests/4/reject", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withCookie ? { cookie: `${ACCESS_TOKEN_COOKIE}=${makeJwt()}` } : {}),
    },
    body: JSON.stringify(body),
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

describe("POST /api/attendance/correction-requests/[id]/reject", () => {
  it("returns 401 without an access token", async () => {
    expect((await POST(request({ motivo: "No" }, false), context("4"))).status).toBe(401);
  });

  it("returns 400 for a bad id or a blank reason without calling the backend", async () => {
    expect((await POST(request({ motivo: "No" }), context("0"))).status).toBe(400);
    expect((await POST(request({ motivo: "   " }), context("4"))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies the rejection with its reason", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 4, estado: "RECHAZADA" }), { status: 200 }),
    );

    const response = await POST(request({ motivo: "Estaba presente." }), context("4"));

    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/api/v1/asistencias/solicitudes-correccion/4/rechazar");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ motivo: "Estaba presente." });
  });
});
