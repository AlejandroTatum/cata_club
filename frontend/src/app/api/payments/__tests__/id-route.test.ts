/**
 * Route Handler Tests — PUT /api/payments/[id]
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed
 * (same pattern as src/app/api/auth/__tests__/session-route.test.ts). Covers
 * the BFF proxy contract: body validation, `PATCH /membresias/pagos/{id}/validar`
 * request shape, the persona/membresia/tipo fan-out used to rebuild the
 * student's name and membership type, and error propagation.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUT } from "../[id]/route";
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

const validAccess = makeJwt(3600);

function putRequest(body: unknown, cookie: string | null = `${ACCESS_TOKEN_COOKIE}=${validAccess}`): NextRequest {
  return new NextRequest("http://localhost/api/payments/42", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

const pagoResponse = {
  id: 42,
  monto: "85.00",
  motivoRechazo: null,
  estadoPago: "APROBADO",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-06-28T10:30:00Z",
  fechaValidacion: "2026-07-18T12:00:00Z",
  fechaInicio: "2026-07-01",
  fechaFin: "2026-07-31",
  personaId: 3,
  membresiaId: 1,
  voucherUrl: "https://example.com/comprobante.pdf",
  voucherFormato: "application/pdf",
};

const persona = { id: 3, nombres: "Sofia", apellidos: "Alumna" };
const membresia = { estado: "ACTIVA", tipoMembresiaId: 5 };
const tipos = [{ id: 5, categoria: "Mensual", franjaHoraria: "Mañana" }];

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("PUT /api/payments/[id] — input validation", () => {
  it("returns 400 on invalid JSON", async () => {
    const request = new NextRequest("http://localhost/api/payments/42", {
      method: "PUT",
      body: "not json {",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${validAccess}` },
    });

    const response = await PUT(request, { params: { id: "42" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when action is missing", async () => {
    const response = await PUT(putRequest({}), { params: { id: "42" } });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("Acción inválida");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when action is unknown", async () => {
    const response = await PUT(putRequest({ action: "bogus" }), { params: { id: "42" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when rejecting without a rejectionReason", async () => {
    const response = await PUT(putRequest({ action: "rejected" }), { params: { id: "42" } });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("motivo de rechazo");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when rejectionReason is whitespace-only", async () => {
    const response = await PUT(
      putRequest({ action: "rejected", rejectionReason: "   " }),
      { params: { id: "42" } },
    );

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await PUT(putRequest({ action: "approved" }, null), { params: { id: "42" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("PUT /api/payments/[id] — approve", () => {
  it("PATCHes /membresias/pagos/{id}/validar with estado_pago APROBADO and returns the translated payment", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse(pagoResponse))
      .mockResolvedValueOnce(jsonResponse(persona))
      .mockResolvedValueOnce(jsonResponse(membresia))
      .mockResolvedValueOnce(jsonResponse(tipos));

    const response = await PUT(putRequest({ action: "approved" }), { params: { id: "42" } });
    const body = await response.json();

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/membresias/pagos/42/validar",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ estado_pago: "APROBADO" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({
      id: "42",
      studentName: "Sofia Alumna",
      membershipPeriod: "01/07/2026 – 31/07/2026",
      membershipType: "Mensual (Mañana)",
      expectedAmount: 85,
      paymentMethod: "Transferencia",
      uploadedAt: "2026-06-28T10:30:00Z",
      currentMembershipStatus: "activa",
      proofFileName: "comprobante.pdf",
      proofFileType: "pdf",
      proofPreviewUrl: "https://example.com/comprobante.pdf",
      validationStatus: "validado",
      validatedAt: "2026-07-18T12:00:00Z",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
  });

  it("falls back to a generic student name when the persona lookup fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse(pagoResponse))
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse(membresia))
      .mockResolvedValueOnce(jsonResponse(tipos));

    const response = await PUT(putRequest({ action: "approved" }), { params: { id: "42" } });
    const body = await response.json();

    expect(body.studentName).toBe("Estudiante");
  });
});

describe("PUT /api/payments/[id] — reject", () => {
  it("PATCHes with estado_pago RECHAZADO and the trimmed motivo_rechazo", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ ...pagoResponse, estadoPago: "RECHAZADO", motivoRechazo: "Monto incorrecto" }))
      .mockResolvedValueOnce(jsonResponse(persona))
      .mockResolvedValueOnce(jsonResponse(membresia))
      .mockResolvedValueOnce(jsonResponse(tipos));

    const response = await PUT(
      putRequest({ action: "rejected", rejectionReason: "  Monto incorrecto  " }),
      { params: { id: "42" } },
    );
    const body = await response.json();

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/membresias/pagos/42/validar",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ estado_pago: "RECHAZADO", motivo_rechazo: "Monto incorrecto" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(body.validationStatus).toBe("rechazado");
  });
});

describe("PUT /api/payments/[id] — backend error propagation", () => {
  it("propagates a 409 conflict from the backend without calling persona/membresia/tipos", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "El pago ya fue validado" }, 409),
    );

    const response = await PUT(putRequest({ action: "approved" }), { params: { id: "42" } });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.message).toBe("El pago ya fue validado");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the backend reports the payment doesn't exist", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Pago no encontrado" }, 404));

    const response = await PUT(putRequest({ action: "approved" }), { params: { id: "999" } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.message).toBe("Pago no encontrado");
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await PUT(putRequest({ action: "approved" }), { params: { id: "42" } });

    expect(response.status).toBe(503);
  });
});
