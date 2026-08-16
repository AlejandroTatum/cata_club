/**
 * Route Handler Tests — POST /api/membresias/:id/regularizar-deuda (issue #284)
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
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
  return new NextRequest(`http://localhost/api/membresias/${membresiaId}/regularizar-deuda`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: JSON.stringify(body),
  });
}

const pagoRegularizado = {
  id: 42,
  monto: "120.00",
  estadoPago: "APROBADO",
  tipoPago: "REGULARIZACION",
  fechaRegistro: "2026-08-15T10:00:00.000000",
  fechaValidacion: "2026-08-15T10:00:00.000000",
  fechaInicio: "2026-04-01",
  fechaFin: "2026-07-31",
  personaId: 9,
  membresiaId: 3,
};

const payload = {
  monto: 120,
  fechaInicio: "2026-04-01",
  fechaFin: "2026-07-31",
  motivo: "Demora del club",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/membresias/[id]/regularizar-deuda", () => {
  it("proxies the payload and forwards the APROBADO payment with 201", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(pagoRegularizado, 201));

    const response = await POST(postRequest("3", payload), { params: { id: "3" } });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(pagoRegularizado);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/3/regularizar-deuda");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(payload);
  });

  it("rejects a non-numeric id with 400 without calling the backend", async () => {
    const response = await POST(postRequest("abc", payload), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("propagates the backend 400 (e.g. solapamiento) with its message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "El período indicado ya está cubierto por un pago aprobado." }, 400),
    );

    const response = await POST(postRequest("3", payload), { params: { id: "3" } });

    expect(response.status).toBe(400);
  });
});
