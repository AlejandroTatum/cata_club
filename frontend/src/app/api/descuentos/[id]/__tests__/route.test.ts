/** @vitest-environment node */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

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

function patchRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/descuentos/1", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/descuentos/[id]", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("returns 401 without an access-token cookie", async () => {
    const response = await PATCH(patchRequest({ activo: false }), { params: { id: "1" } });
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric id", async () => {
    const token = makeJwt(3600);
    const response = await PATCH(
      patchRequest({ activo: false }, `${ACCESS_TOKEN_COOKIE}=${token}`),
      { params: { id: "abc" } },
    );
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the body carries none of the updatable fields", async () => {
    const token = makeJwt(3600);
    const response = await PATCH(
      patchRequest({ otra: "cosa" }, `${ACCESS_TOKEN_COOKIE}=${token}`),
      { params: { id: "1" } },
    );
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards only the provided fields (soft toggle)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ id: 1, nombre: "Beca municipal", porcentaje: "100", monto: null, activo: false }),
    );
    const token = makeJwt(3600);
    const response = await PATCH(
      patchRequest({ activo: false }, `${ACCESS_TOKEN_COOKIE}=${token}`),
      { params: { id: "1" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 1, activo: false });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/descuentos/1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ activo: false }) }),
    );
  });

  it("forwards explicit nulls so the modality can change", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ id: 1, nombre: "Convenio", porcentaje: null, monto: "10.00", activo: true }),
    );
    const token = makeJwt(3600);
    const response = await PATCH(
      patchRequest({ porcentaje: null, monto: 10 }, `${ACCESS_TOKEN_COOKIE}=${token}`),
      { params: { id: "1" } },
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/descuentos/1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ porcentaje: null, monto: 10 }) }),
    );
  });

  it("surfaces the backend domain message on a 400 (ambiguous state)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "El descuento debe definir exactamente uno: porcentaje o monto fijo" }, 400),
    );
    const token = makeJwt(3600);
    const response = await PATCH(
      patchRequest({ monto: 5 }, `${ACCESS_TOKEN_COOKIE}=${token}`),
      { params: { id: "1" } },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "El descuento debe definir exactamente uno: porcentaje o monto fijo",
      mensaje_seguro: false,
    });
  });

  it("passes a backend 404 through to the client", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Descuento no encontrado" }, 404));
    const token = makeJwt(3600);
    const response = await PATCH(
      patchRequest({ activo: false }, `${ACCESS_TOKEN_COOKIE}=${token}`),
      { params: { id: "999" } },
    );
    expect(response.status).toBe(404);
  });
});
