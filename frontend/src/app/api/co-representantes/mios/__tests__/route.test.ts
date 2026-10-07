/**
 * Route Handler Tests — GET /api/co-representantes/mios
 *
 * @vitest-environment node
 */

import { GET } from "../route";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

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

const COOKIE = `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/co-representantes/mios", {
    headers: cookie ? { cookie } : {},
  });
}

describe("GET /api/co-representantes/mios", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies the minors with their guardians", async () => {
    const menores = [{ personaId: 10, nombres: "Nico", apellidos: "Torres", rol: "PRINCIPAL", segundoGuardian: null, completo: false }];
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(menores));

    const response = await GET(getRequest(COOKIE));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(menores);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/co-representantes/mios",
      expect.anything(),
    );
  });
});
