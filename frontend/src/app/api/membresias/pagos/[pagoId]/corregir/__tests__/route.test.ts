/**
 * Route Handler Tests — POST /api/membresias/pagos/[pagoId]/corregir
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

function postRequest(pagoId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/pagos/${pagoId}/corregir`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: JSON.stringify(body),
  });
}

function postRawRequest(pagoId: string, rawBody: string): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/pagos/${pagoId}/corregir`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: rawBody,
  });
}

const resultado = {
  pago: {
    id: 9,
    monto: "40.00",
    motivoRechazo: null,
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
    comprobanteOficialUrl: null,
    descuentoValorAplicado: null,
    descuentoPorcentajeAplicado: null,
  },
  correccion: {
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
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/membresias/pagos/[pagoId]/corregir", () => {
  it("translates camelCase fields to snake_case and returns the result with 201", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(resultado, 201));

    const response = await POST(
      postRequest("9", { monto: "40.00", motivo: "Ajuste de tipeo" }),
      { params: { pagoId: "9" } },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(resultado);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/pagos/9/corregir");
    expect(JSON.parse(String(init.body))).toEqual({ monto: "40.00", motivo: "Ajuste de tipeo" });
  });

  it("only forwards the fields actually sent (omitted fields stay omitted, not null)", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(resultado, 201));

    await POST(
      postRequest("9", {
        tarifaMensualAplicada: "35.00",
        mesesComprados: 2,
        fechaInicio: "2026-08-01",
        motivo: "Corrección completa",
      }),
      { params: { pagoId: "9" } },
    );

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      tarifa_mensual_aplicada: "35.00",
      meses_comprados: 2,
      fecha_inicio: "2026-08-01",
      motivo: "Corrección completa",
    });
  });

  it("rejects a non-numeric pagoId with 400 without calling the backend", async () => {
    const response = await POST(postRequest("abc", { motivo: "x" }), { params: { pagoId: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400 without calling the backend", async () => {
    const response = await POST(postRawRequest("9", "{no-json"), { params: { pagoId: "9" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing motivo with 400 without calling the backend", async () => {
    const response = await POST(postRequest("9", { monto: "40.00" }), { params: { pagoId: "9" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects an empty motivo with 400 without calling the backend", async () => {
    const response = await POST(postRequest("9", { motivo: "   " }), { params: { pagoId: "9" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's 403 when the caller is not an administrator", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await POST(postRequest("9", { motivo: "x" }), { params: { pagoId: "9" } });

    expect(response.status).toBe(403);
  });
});
