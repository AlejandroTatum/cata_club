/**
 * Route Handler Tests — POST /api/membresias/[id]/aplicar-beneficio (issue #400, slice 06)
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
 * Same shape as membresias/pagos/__tests__/route.test.ts.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function postRequest(membresiaId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/${membresiaId}/aplicar-beneficio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: JSON.stringify(body),
  });
}

function postRawRequest(membresiaId: string, rawBody: string): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/${membresiaId}/aplicar-beneficio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: rawBody,
  });
}

const coberturaBonificada = {
  id: 7,
  membresiaId: 3,
  personaId: 9,
  asignacionDescuento: {
    id: 1,
    personaId: 9,
    descuento: { id: 2, nombre: "Beca 100%", porcentaje: "100.00", monto: null, activo: true },
    asignadoPorPersonaId: 1,
    asignadoEn: "2026-08-01T00:00:00Z",
    retiradoPorPersonaId: null,
    retiradoEn: null,
  },
  tarifaMensualAplicada: "35.00",
  mesesComprados: 1,
  descuentoValorAplicado: "35.00",
  descuentoPorcentajeAplicado: "100.00",
  fechaInicio: "2026-08-01",
  fechaFin: "2026-08-31",
  otorgadaPorPersonaId: 9,
  otorgadaEn: "2026-08-18T10:00:00.000000",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/membresias/[id]/aplicar-beneficio", () => {
  it("proxies meses and returns the granted CoberturaBonificada with 201", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(coberturaBonificada, 201));

    const response = await POST(postRequest("3", { meses: 1 }), { params: { id: "3" } });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(coberturaBonificada);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/3/aplicar-beneficio");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ meses: 1 });
  });

  it("rejects a non-numeric membresia id with 400 without calling the backend", async () => {
    const response = await POST(postRequest("abc", { meses: 1 }), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400 without calling the backend", async () => {
    const response = await POST(postRawRequest("3", "{no-json"), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("rejects a missing/non-numeric meses with 400 without calling the backend", async () => {
    const response = await POST(postRequest("3", { meses: "1" }), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("relays the backend's 400 (e.g. beneficio no cubre el 100%) with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "El beneficio vigente no cubre el 100% de este período." }, 400),
    );

    const response = await POST(postRequest("3", { meses: 1 }), { params: { id: "3" } });

    expect(response.status).toBe(400);
  });

  it("relays the backend's 403 when the caller is neither owner nor representative", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await POST(postRequest("3", { meses: 1 }), { params: { id: "3" } });

    expect(response.status).toBe(403);
  });

  // Issue #400 (entrega 08): pin the exact status the backend returns for
  // 409/422, not a genericized 500 — a route that swallows the real status
  // here would still 200 or 500 in these tests without this assertion.
  it("relays the backend's 409 as-is", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Conflicto" }, 409));

    const response = await POST(postRequest("3", { meses: 1 }), { params: { id: "3" } });

    expect(response.status).toBe(409);
  });

  it("relays the backend's 422 as-is", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Entidad no procesable" }, 422));

    const response = await POST(postRequest("3", { meses: 1 }), { params: { id: "3" } });

    expect(response.status).toBe(422);
  });
});
