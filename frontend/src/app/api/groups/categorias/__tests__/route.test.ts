/**
 * Route Handler Tests — POST /api/groups/categorias
 *
 * docs/archive/fixes/24-abm-categorias.md: creates a categoria and one horario per
 * día marked, atomically. The backend's `CategoriaCreateDTO` accepts
 * exactly `nombre`, `hora_inicio`, `hora_fin`, `dias` — `codigo` is server-
 * derived, never client input.
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
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

function postRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/groups/categorias", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
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

describe("POST /api/groups/categorias", () => {
  const validBody = { nombre: "Preinfantil", hora_inicio: "15:00", hora_fin: "16:00", dias: ["LUNES", "MIERCOLES"] };

  it("returns 401 when no access token cookie is present", async () => {
    const response = await POST(postRequest(validBody));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards nombre/hora_inicio/hora_fin/dias with the bearer token", async () => {
    const creada = { codigo: "PREINFANTIL", label: "Preinfantil", horaInicio: "15:00:00", horaFin: "16:00:00", dias: ["LUNES", "MIERCOLES"] };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(creada, 201));

    const access = makeJwt(3600);
    const response = await POST(postRequest(validBody, `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/categorias",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
    expect(forwardedBody()).toEqual(validBody);
    expect(response.status).toBe(201);
    expect(body).toEqual(creada);
  });

  it("returns 400 when nombre is missing", async () => {
    const access = makeJwt(3600);
    const response = await POST(
      postRequest({ hora_inicio: "15:00", hora_fin: "16:00", dias: ["LUNES"] }, `${ACCESS_TOKEN_COOKIE}=${access}`),
    );

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when dias is not an array (triangulation)", async () => {
    const access = makeJwt(3600);
    const response = await POST(
      postRequest({ ...validBody, dias: "LUNES" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
    );

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not forward a client-supplied codigo — the server derives it", async () => {
    const creada = { codigo: "PREINFANTIL", label: "Preinfantil", horaInicio: "15:00:00", horaFin: "16:00:00", dias: ["LUNES"] };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(creada, 201));

    const access = makeJwt(3600);
    await POST(
      postRequest({ ...validBody, codigo: "CODIGO_INVENTADO" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
    );

    expect(forwardedBody()).toEqual(validBody);
  });

  // #789 — the optional ages label. It is orientation copy for the public
  // board, never a rule, so a categoría created without one is valid.
  it("forwards edades when the admin typed an ages label", async () => {
    const creada = { codigo: "PREINFANTIL", label: "Preinfantil", horaInicio: "15:00:00", horaFin: "16:00:00", dias: ["LUNES"], edades: "5 a 10 años" };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(creada, 201));

    const access = makeJwt(3600);
    await POST(postRequest({ ...validBody, edades: "5 a 10 años" }, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(forwardedBody()).toEqual({ ...validBody, edades: "5 a 10 años" });
  });

  it("creates without edades when the field is absent (the label is optional)", async () => {
    const creada = { codigo: "PREINFANTIL", label: "Preinfantil", horaInicio: "15:00:00", horaFin: "16:00:00", dias: ["LUNES"], edades: null };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(creada, 201));

    const access = makeJwt(3600);
    const response = await POST(postRequest(validBody, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(forwardedBody()).toEqual(validBody);
    expect(forwardedBody()).not.toHaveProperty("edades");
    expect(response.status).toBe(201);
  });

  it("does not forward a non-string edades — the allowlist stayed an allowlist", async () => {
    const creada = { codigo: "PREINFANTIL", label: "Preinfantil", horaInicio: "15:00:00", horaFin: "16:00:00", dias: ["LUNES"], edades: null };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(creada, 201));

    const access = makeJwt(3600);
    await POST(postRequest({ ...validBody, edades: 12, apodo: "x" }, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(forwardedBody()).toEqual(validBody);
  });

  it("propagates backend errors", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ message: 'Ya existe una categoría llamada "Preinfantil".' }, 400));

    const access = makeJwt(3600);
    const response = await POST(postRequest(validBody, `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe('Ya existe una categoría llamada "Preinfantil".');
  });
});
