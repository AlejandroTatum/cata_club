/**
 * Route Handler Tests — POST /api/groups/categorias/[codigo]/mover-alumnos
 *
 * QA4 ADMB-04: move the chosen players (one by one) to a target category without deleting.
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

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${header}.${base64Url(JSON.stringify({ sub: "1", exp }))}.sig`;
}

function post(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/groups/categorias/FORMATIVO/mover-alumnos", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const PARAMS = { params: Promise.resolve({ codigo: "FORMATIVO" }) };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/groups/categorias/[codigo]/mover-alumnos", () => {
  it("returns 401 without an access token cookie", async () => {
    const response = await POST(post({ categoria_destino: "INFANTIL", persona_ids: [10, 11] }), PARAMS);
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when categoria_destino is missing", async () => {
    const access = makeJwt(3600);
    const response = await POST(post({}, `${ACCESS_TOKEN_COOKIE}=${access}`), PARAMS);
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards only the allowlisted fields to the backend with the bearer token", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ movidos: 2, categoriaDestino: "INFANTIL", categoriaDestinoLabel: "Infantil", eliminada: true, motivo: null }));
    const access = makeJwt(3600);

    const response = await POST(
      post({ categoria_destino: "INFANTIL", persona_ids: [10, 11], otro: "x" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      PARAMS,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/categorias/FORMATIVO/mover-alumnos",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
    const init = vi.mocked(global.fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ categoria_destino: "INFANTIL", persona_ids: [10, 11] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ movidos: 2, categoriaDestino: "INFANTIL", categoriaDestinoLabel: "Infantil", eliminada: true, motivo: null });
  });

  it("passes the backend's refusal through", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "El destino no existe." }, 404));
    const access = makeJwt(3600);
    const response = await POST(post({ categoria_destino: "NOPE", persona_ids: [10, 11] }, `${ACCESS_TOKEN_COOKIE}=${access}`), PARAMS);
    expect(response.status).toBe(404);
  });
});
