/**
 * Route Handler Tests — GET /api/ranking/niveles/[id]/tabla
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";
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

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/ranking/niveles/1/tabla", { headers: cookie ? { cookie } : {} });
}

const tablaItem = {
  personaId: 3,
  personaNombreCompleto: "Sofia Alumna",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/ranking/niveles/[id]/tabla", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest(), { params: { id: "1" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("passes through /ranking/niveles/:id/tabla unmodified", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([tablaItem]));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), { params: { id: "1" } });
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/ranking/niveles/1/tabla",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${access}` }) }),
    );
    expect(response.status).toBe(200);
    expect(body).toEqual([tablaItem]);
  });

  it("propagates a 404 when the nivel doesn't exist", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Nivel de ranking con id 999 no encontrado" }, 404));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), { params: { id: "999" } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.message).toBe("Nivel de ranking con id 999 no encontrado");
  });
});
