/**
 * Route Handler Tests — GET /api/membresias/pagos/[pagoId]/correcciones
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

function getRequest(pagoId: string): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/pagos/${pagoId}/correcciones`, {
    headers: { cookie: `${ACCESS_TOKEN_COOKIE}=token` },
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

describe("GET /api/membresias/pagos/[pagoId]/correcciones", () => {
  it("proxies to /membresias/pagos/:id/correcciones and returns the list as-is", async () => {
    const correcciones = [
      {
        id: 1,
        pagoId: 9,
        tarifaMensualAplicadaAnterior: null,
        tarifaMensualAplicadaNuevo: null,
        mesesCompradosAnterior: null,
        mesesCompradosNuevo: null,
        montoBaseAnterior: null,
        montoBaseNuevo: null,
        montoAnterior: "30.00",
        montoNuevo: "40.00",
        fechaInicioAnterior: "2026-08-01",
        fechaInicioNuevo: "2026-08-01",
        fechaFinAnterior: "2026-08-31",
        fechaFinNuevo: "2026-08-31",
        efectoCobertura: "SIN_CAMBIO",
        motivo: "Ajuste de tipeo",
        actorPersonaId: 1,
        fechaRegistro: "2026-08-10T00:00:00Z",
      },
    ];
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(correcciones));

    const response = await GET(getRequest("9"), { params: { pagoId: "9" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(correcciones);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/pagos/9/correcciones",
      expect.anything(),
    );
  });

  it("rejects a non-numeric pagoId with 400 without calling the backend", async () => {
    const response = await GET(getRequest("abc"), { params: { pagoId: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's 403 when the caller is not an administrator", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await GET(getRequest("9"), { params: { pagoId: "9" } });

    expect(response.status).toBe(403);
  });

  // Issue #400 (entrega 08): pin the exact status the backend returns for
  // 409/422, not a genericized 500 — a route that swallows the real status
  // here would still 200 or 500 in these tests without this assertion.
  it("relays the backend's 409 as-is", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Conflicto" }, 409));

    const response = await GET(getRequest("9"), { params: { pagoId: "9" } });

    expect(response.status).toBe(409);
  });

  it("relays the backend's 422 as-is", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Entidad no procesable" }, 422));

    const response = await GET(getRequest("9"), { params: { pagoId: "9" } });

    expect(response.status).toBe(422);
  });
});
