/** @vitest-environment node */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }));
  return `${header}.${payload}.sig`;
}

function request(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/membresias/pagos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/membresias/pagos", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const token = makeJwt(3600);
    const req = new NextRequest("http://localhost/api/membresias/pagos", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${token}` },
      body: "{invalid json",
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when required fields are missing", async () => {
    const token = makeJwt(3600);
    const response = await POST(request({ monto: 50, tipoPago: "TRANSFERENCIA" }, `${ACCESS_TOKEN_COOKIE}=${token}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({ message: expect.stringContaining("Faltan campos obligatorios") }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("translates camelCase to snake_case and proxies to the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          id: 42,
          monto: "50.00",
          estadoPago: "PENDIENTE_VALIDACION",
          tipoPago: "TRANSFERENCIA",
          fechaRegistro: "2026-07-23T10:00:00Z",
          fechaValidacion: null,
          fechaInicio: "2026-08-01",
          fechaFin: "2026-08-31",
          personaId: 9,
          membresiaId: 4,
          voucherUrl: null,
          voucherFormato: null,
          voucherFechaCarga: null,
        },
        201,
      ),
    );
    const token = makeJwt(3600);
    const response = await POST(
      request(
        {
          monto: 50,
          tipoPago: "TRANSFERENCIA",
          fechaInicio: "2026-08-01",
          fechaFin: "2026-08-31",
          personaId: 9,
          membresiaId: 4,
        },
        `${ACCESS_TOKEN_COOKIE}=${token}`,
      ),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 42, estadoPago: "PENDIENTE_VALIDACION" });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/pagos",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          monto: 50,
          tipo_pago: "TRANSFERENCIA",
          fecha_inicio: "2026-08-01",
          fecha_fin: "2026-08-31",
          persona_id: 9,
          membresia_id: 4,
        }),
      }),
    );
  });

  it("forwards descuentoIds as descuento_ids when provided (issue #12)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ id: 43, estadoPago: "PENDIENTE_VALIDACION", descuentosAplicados: [] }, 201),
    );
    const token = makeJwt(3600);
    const response = await POST(
      request(
        {
          monto: 35,
          tipoPago: "EFECTIVO",
          fechaInicio: "2026-08-01",
          fechaFin: "2026-08-31",
          personaId: 9,
          membresiaId: 4,
          descuentoIds: [1, 2],
        },
        `${ACCESS_TOKEN_COOKIE}=${token}`,
      ),
    );

    expect(response.status).toBe(201);
    const forwarded = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]?.[1]?.body));
    expect(forwarded.descuento_ids).toEqual([1, 2]);
  });

  it("rejects a malformed descuentoIds (not an array of numbers) with 400", async () => {
    const token = makeJwt(3600);
    const response = await POST(
      request(
        {
          monto: 35,
          tipoPago: "EFECTIVO",
          fechaInicio: "2026-08-01",
          fechaFin: "2026-08-31",
          personaId: 9,
          membresiaId: 4,
          descuentoIds: ["uno"],
        },
        `${ACCESS_TOKEN_COOKIE}=${token}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("surfaces the backend cap-exceeded 400 message to the client", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "El descuento total no puede superar el 100% del monto" }, 400),
    );
    const token = makeJwt(3600);
    const response = await POST(
      request(
        {
          monto: 35,
          tipoPago: "EFECTIVO",
          fechaInicio: "2026-08-01",
          fechaFin: "2026-08-31",
          personaId: 9,
          membresiaId: 4,
          descuentoIds: [1, 2],
        },
        `${ACCESS_TOKEN_COOKIE}=${token}`,
      ),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "El descuento total no puede superar el 100% del monto",
    });
  });

  it("passes an opaque backend 403 through to the client", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Solo la propia persona, su representante, o un administrador pueden registrar este pago" }, 403));
    const token = makeJwt(3600);
    const response = await POST(
      request(
        {
          monto: 50,
          tipoPago: "EFECTIVO",
          fechaInicio: "2026-08-01",
          fechaFin: "2026-08-31",
          personaId: 1,
          membresiaId: 4,
        },
        `${ACCESS_TOKEN_COOKIE}=${token}`,
      ),
    );
    expect(response.status).toBe(403);
  });

  it("rotates a refreshed access token when the backend issues one", async () => {
    const expired = makeJwt(-1);
    const fresh = makeJwt(3600);
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: fresh, token_type: "bearer" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: 99,
            monto: "50.00",
            estadoPago: "PENDIENTE_VALIDACION",
            tipoPago: "EFECTIVO",
            fechaRegistro: "2026-07-23T10:00:00Z",
            fechaValidacion: null,
            fechaInicio: "2026-08-01",
            fechaFin: "2026-08-31",
            personaId: 1,
            membresiaId: 4,
            voucherUrl: null,
            voucherFormato: null,
            voucherFechaCarga: null,
          },
          201,
        ),
      );
    const response = await POST(
      request(
        {
          monto: 50,
          tipoPago: "EFECTIVO",
          fechaInicio: "2026-08-01",
          fechaFin: "2026-08-31",
          personaId: 1,
          membresiaId: 4,
        },
        `${ACCESS_TOKEN_COOKIE}=${expired}; ${REFRESH_TOKEN_COOKIE}=refresh-token`,
      ),
    );
    expect(response.status).toBe(201);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe(fresh);
  });
});
