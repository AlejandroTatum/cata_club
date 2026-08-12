/**
 * Route Handler Tests — PUT/DELETE /api/groups/categorias/[codigo]
 *
 * docs/fixes/24-abm-categorias.md: PUT speaks the categoria-edit contract
 * (`nombre`/`hora_inicio`/`hora_fin`/`dias`, all optional, applied with
 * `exclude_unset`); DELETE removes the categoria and every one of its
 * horarios, blocked server-side (400) when any has real Asistencia history.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUT, DELETE } from "../route";
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

function putRequest(body: unknown, cookie = "", codigo = "PREINFANTIL"): NextRequest {
  return new NextRequest(`http://localhost/api/groups/categorias/${codigo}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function deleteRequest(cookie = "", codigo = "PREINFANTIL"): NextRequest {
  return new NextRequest(`http://localhost/api/groups/categorias/${codigo}`, {
    method: "DELETE",
    headers: cookie ? { cookie } : {},
  });
}

/** The JSON body the handler forwarded to FastAPI on its Nth fetch. */
function forwardedBody(callIndex = 0): Record<string, unknown> {
  const init = vi.mocked(global.fetch).mock.calls[callIndex]?.[1];
  return JSON.parse(String(init?.body));
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("PUT /api/groups/categorias/[codigo]", () => {
  it("returns 401 when no access token cookie is present", async () => {
    const response = await PUT(putRequest({ nombre: "Preinfantil A" }), { params: { codigo: "PREINFANTIL" } });
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards nombre/hora_inicio/hora_fin/dias to the backend with the bearer token", async () => {
    const actualizada = { codigo: "PREINFANTIL", label: "Preinfantil A", horaInicio: "15:00:00", horaFin: "16:00:00", dias: ["LUNES"] };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(actualizada));

    const access = makeJwt(3600);
    const response = await PUT(
      putRequest(
        { nombre: "Preinfantil A", hora_inicio: "15:00", hora_fin: "16:00", dias: ["LUNES"] },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
      { params: { codigo: "PREINFANTIL" } },
    );
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/categorias/PREINFANTIL",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
    expect(forwardedBody()).toEqual({ nombre: "Preinfantil A", hora_inicio: "15:00", hora_fin: "16:00", dias: ["LUNES"] });
    expect(response.status).toBe(200);
    expect(body).toEqual(actualizada);
  });

  it("forwards only the fields present in the body (partial update)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ codigo: "PREINFANTIL" }));

    const access = makeJwt(3600);
    await PUT(putRequest({ nombre: "Preinfantil A" }, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { codigo: "PREINFANTIL" },
    });

    expect(forwardedBody()).toEqual({ nombre: "Preinfantil A" });
  });

  it("returns 400 when the payload carries no updatable field", async () => {
    const access = makeJwt(3600);
    const response = await PUT(putRequest({}, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { codigo: "PREINFANTIL" },
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("propagates backend errors (e.g. blocked by real Asistencia history)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "No se puede quitar el día lunes de Preinfantil: ya tiene asistencias registradas. El historial no se borra." }, 400),
    );

    const access = makeJwt(3600);
    const response = await PUT(
      putRequest({ dias: ["MARTES"] }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { codigo: "PREINFANTIL" } },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toMatch(/el historial no se borra/i);
  });
});

describe("DELETE /api/groups/categorias/[codigo]", () => {
  it("returns 401 when no access token cookie is present", async () => {
    const response = await DELETE(deleteRequest(), { params: { codigo: "PREINFANTIL" } });
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies DELETE /asistencias/categorias/{codigo} with the bearer token", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const access = makeJwt(3600);
    const response = await DELETE(deleteRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { codigo: "PREINFANTIL" },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/categorias/PREINFANTIL",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
    expect(response.status).toBe(204);
  });

  it("propagates a 400 when the backend blocks deletion (real Asistencia history)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: 'No se puede eliminar la categoría "Preinfantil": el día lunes tiene asistencias registradas. El historial no se borra.' }, 400),
    );

    const access = makeJwt(3600);
    const response = await DELETE(deleteRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { codigo: "PREINFANTIL" },
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toMatch(/el historial no se borra/i);
  });
});
