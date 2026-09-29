/**
 * Route Handler Tests — GET /api/membresias/coberturas/persona/:id
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
  return `${header}.${payload}.${base64Url("sig")}`;
}

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/membresias/coberturas/persona/9", {
    headers: cookie ? { cookie } : {},
  });
}

const cobertura = {
  id: 4,
  membresiaId: 3,
  personaId: 9,
  asignacionDescuento: { id: 2, descuento: { id: 1, nombre: "Becado" } },
  tarifaMensualAplicada: "35.00",
  mesesComprados: 1,
  descuentoValorAplicado: null,
  descuentoPorcentajeAplicado: "100.00",
  fechaInicio: "2026-09-01",
  fechaFin: "2026-09-30",
  otorgadaPorPersonaId: 9,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/membresias/coberturas/persona/:id", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest(), { params: Promise.resolve({ id: "9" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("passes through /membresias/coberturas/persona/:id unmodified", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([cobertura]));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "9" }) });
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/coberturas/persona/9",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${access}` }) }),
    );
    expect(response.status).toBe(200);
    expect(body).toEqual([cobertura]);
  });

  it("propagates the backend's 403 for a persona ajena", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Solo la propia persona, su representante, o un administrador pueden ver este historial de pagos" }, 403),
    );

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "9" }) });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.message).toBe(
      "Solo la propia persona, su representante, o un administrador pueden ver este historial de pagos",
    );
  });
});
