/**
 * Route Handler Tests — GET /api/membresias/pagos/persona/:id
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
  return new NextRequest("http://localhost/api/membresias/pagos/persona/9", {
    headers: cookie ? { cookie } : {},
  });
}

const pagoRechazado = {
  id: 8,
  monto: "35.00",
  motivoRechazo: "Comprobante ilegible",
  estadoPago: "RECHAZADO",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-07-01T09:00:00.000000",
  fechaValidacion: "2026-07-02T14:30:00.000000",
  fechaInicio: "2026-07-01",
  fechaFin: "2026-07-31",
  personaId: 9,
  membresiaId: 3,
  voucherUrl: null,
  voucherFormato: null,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/membresias/pagos/persona/:id", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest(), { params: Promise.resolve({ id: "9" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("passes through /membresias/pagos/persona/:id unmodified, including motivoRechazo", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([pagoRechazado]));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "9" }) });
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/pagos/persona/9",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${access}` }) }),
    );
    expect(response.status).toBe(200);
    expect(body).toEqual([pagoRechazado]);
  });

  it("propagates the backend's status and message on failure (e.g. persona ajena)", async () => {
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

  it("is never gated by the non-payment block: a blocked profile's Payments history is served as-is (#1779 S4)", async () => {
    // Payments is the one module a blocked profile keeps — it is how they pay and get back in.
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([pagoRechazado]));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "9" }) });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(global.fetch).mock.calls[0][0])).toContain("/membresias/pagos/persona/9");
  });

  // #1779 S7 / #1787: the payments screen reads `autodeclarado` off this very
  // payload to decide whether a pending cash payment may be replaced by a
  // transfer. The handler must hand the flag over untouched: `true` and `false`
  // as the backend sent them, and a field the backend omits stays omitted.
  it("delivers autodeclarado to the browser exactly as the backend sent it", async () => {
    const pendiente = { ...pagoRechazado, estadoPago: "PENDIENTE_VALIDACION", tipoPago: "EFECTIVO", motivoRechazo: null };
    const backendBody = [
      { ...pendiente, id: 1, autodeclarado: true },
      { ...pendiente, id: 2, autodeclarado: false },
      { ...pendiente, id: 3 },
    ];
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(backendBody));

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`), { params: Promise.resolve({ id: "9" }) });
    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body.map((pago) => pago.autodeclarado)).toEqual([true, false, undefined]);
    expect("autodeclarado" in body[2]).toBe(false);
    expect(body).toEqual(backendBody);
  });
});
