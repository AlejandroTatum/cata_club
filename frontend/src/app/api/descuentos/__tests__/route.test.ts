/** @vitest-environment node */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../route";
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

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/descuentos", {
    method: "GET",
    headers: cookie ? { cookie } : {},
  });
}

function postRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/descuentos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const DESCUENTO = { id: 1, nombre: "Beca municipal", porcentaje: "100", monto: null, activo: true };

describe("GET /api/descuentos", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("returns 401 without an access-token cookie", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies the full catalog (active + inactive) from the backend", async () => {
    const inactivo = { ...DESCUENTO, id: 2, nombre: "Beca vieja", activo: false };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([DESCUENTO, inactivo]));

    const token = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${token}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([DESCUENTO, inactivo]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/descuentos/",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${token}` }) }),
    );
  });

  it("passes a backend 403 (non-admin) through to the client", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Permisos insuficientes" }, 403));
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    expect(response.status).toBe(403);
  });
});

describe("POST /api/descuentos", () => {
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
    const req = new NextRequest("http://localhost/api/descuentos", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${token}` },
      body: "{invalid json",
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when nombre is missing", async () => {
    const token = makeJwt(3600);
    const response = await POST(postRequest({ porcentaje: 50 }, `${ACCESS_TOKEN_COOKIE}=${token}`));
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("creates a percentage discount and answers 201", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(DESCUENTO, 201));
    const token = makeJwt(3600);
    const response = await POST(
      postRequest({ nombre: "Beca municipal", porcentaje: 100, monto: null }, `${ACCESS_TOKEN_COOKIE}=${token}`),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 1, nombre: "Beca municipal" });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/descuentos/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ nombre: "Beca municipal", porcentaje: 100, monto: null }),
      }),
    );
  });

  it("surfaces the backend domain message on a 400 (duplicate name)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Ya existe un descuento con ese nombre" }, 400),
    );
    const token = makeJwt(3600);
    const response = await POST(
      postRequest({ nombre: "Beca municipal", porcentaje: 50 }, `${ACCESS_TOKEN_COOKIE}=${token}`),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Ya existe un descuento con ese nombre",
      mensaje_seguro: false,
    });
  });
});
