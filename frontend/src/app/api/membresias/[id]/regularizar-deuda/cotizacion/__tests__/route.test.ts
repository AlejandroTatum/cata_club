/**
 * Route Handler Tests — GET /api/membresias/:id/regularizar-deuda/cotizacion (QA3 ADM-09)
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

function getRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/3/regularizar-deuda/cotizacion${query}`, {
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

describe("GET /api/membresias/[id]/regularizar-deuda/cotizacion", () => {
  it("maps the camelCase dates to the backend's snake_case query and forwards the quote", async () => {
    const cotizacion = { meses: 2, montoBase: "60.00", descuentoAplicado: "30.00", montoEsperado: "30.00" };
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(cotizacion));

    const response = await GET(getRequest("?fechaInicio=2026-04-01&fechaFin=2026-05-31"), {
      params: Promise.resolve({ id: "3" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(cotizacion);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:8000/api/v1/membresias/3/regularizar-deuda/cotizacion?fecha_inicio=2026-04-01&fecha_fin=2026-05-31",
    );
  });

  it("rejects missing dates with 400 without calling the backend", async () => {
    const response = await GET(getRequest("?fechaInicio=2026-04-01"), {
      params: Promise.resolve({ id: "3" }),
    });

    expect(response.status).toBe(400);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });
});
