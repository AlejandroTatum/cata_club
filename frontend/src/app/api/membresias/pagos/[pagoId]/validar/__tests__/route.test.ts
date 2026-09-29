/**
 * Route Handler Tests — PATCH /api/membresias/pagos/[pagoId]/validar
 *
 * The validation queue's own write action, proxied for the admin panel. The
 * BFF is a thin relay: shape-validates `estadoPago`, maps camelCase →
 * snake_case (including the audited no-voucher exception fields), and passes
 * the backend's status through. Issue #1402's in-person transfer flow calls
 * this route only AFTER the voucher upload succeeded — the BFF adds no
 * business logic and must never decide an approval itself.
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
 * Same shape as membresias/pagos/[pagoId]/__tests__/route.test.ts.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PATCH } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function patchRequest(pagoId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/pagos/${pagoId}/validar`, {
    method: "PATCH",
    headers: { cookie: `${ACCESS_TOKEN_COOKIE}=token`, "Content-Type": "application/json" },
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

describe("PATCH /api/membresias/pagos/[pagoId]/validar", () => {
  it("maps camelCase to the backend's snake_case DTO and relays the validated payment", async () => {
    const pago = { id: 9, estadoPago: "APROBADO", validadoPorPersonaId: 1 };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(pago));

    const response = await PATCH(patchRequest("9", { estadoPago: "APROBADO" }), {
      params: Promise.resolve({ pagoId: "9" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(pago);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/pagos/9/validar",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ estado_pago: "APROBADO" }),
      }),
    );
  });

  it("maps the optional rejection reason and no-voucher exception fields", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ id: 9, estadoPago: "RECHAZADO" }),
    );

    const response = await PATCH(
      patchRequest("9", { estadoPago: "RECHAZADO", motivoRechazo: "ilegible" }),
      { params: Promise.resolve({ pagoId: "9" }) },
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/pagos/9/validar",
      expect.objectContaining({
        body: JSON.stringify({ estado_pago: "RECHAZADO", motivo_rechazo: "ilegible" }),
      }),
    );
  });

  it("rejects an estadoPago other than APROBADO/RECHAZADO with 400 without calling the backend", async () => {
    const response = await PATCH(patchRequest("9", { estadoPago: "PENDIENTE_VALIDACION" }), {
      params: Promise.resolve({ pagoId: "9" }),
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric pagoId with 400 without calling the backend", async () => {
    const response = await PATCH(patchRequest("abc", { estadoPago: "APROBADO" }), {
      params: Promise.resolve({ pagoId: "abc" }),
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's 400 when approval is refused (e.g. transfer without voucher)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "comprobante obligatorio" }, 400),
    );

    const response = await PATCH(patchRequest("9", { estadoPago: "APROBADO" }), {
      params: Promise.resolve({ pagoId: "9" }),
    });

    expect(response.status).toBe(400);
  });
});
