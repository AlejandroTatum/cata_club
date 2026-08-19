/**
 * Route Handler Tests — GET /api/membresias/pagos/[pagoId]
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
 * Same shape as membresias/pagos/persona/[id]/__tests__/route.test.ts.
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
  return new NextRequest(`http://localhost/api/membresias/pagos/${pagoId}`, {
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

describe("GET /api/membresias/pagos/[pagoId]", () => {
  it("proxies to /membresias/pagos/:id and passes the comprobanteOficialUrl through", async () => {
    const pago = {
      id: 9,
      monto: "30.00",
      estadoPago: "APROBADO",
      tipoPago: "EFECTIVO",
      fechaRegistro: "2026-08-01T00:00:00Z",
      fechaValidacion: "2026-08-02T00:00:00Z",
      fechaInicio: "2026-08-01",
      fechaFin: "2026-08-31",
      personaId: 2,
      membresiaId: 3,
      voucherUrl: null,
      voucherFormato: null,
      comprobanteOficialUrl: "https://signed.example.com/comprobante-9.pdf",
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(pago));

    const response = await GET(getRequest("9"), { params: { pagoId: "9" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(pago);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/pagos/9",
      expect.anything(),
    );
  });

  it("rejects a non-numeric pagoId with 400 without calling the backend", async () => {
    const response = await GET(getRequest("abc"), { params: { pagoId: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's 403 when the caller has no relation to the pago", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await GET(getRequest("9"), { params: { pagoId: "9" } });

    expect(response.status).toBe(403);
  });

  it("relays the backend's 404 when the pago does not exist", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No encontrado" }, 404));

    const response = await GET(getRequest("999"), { params: { pagoId: "999" } });

    expect(response.status).toBe(404);
  });
});
