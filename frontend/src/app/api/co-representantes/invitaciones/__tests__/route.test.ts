/**
 * Route Handler Tests — POST /api/co-representantes/invitaciones
 *
 * @vitest-environment node
 */

import { POST } from "../route";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const COOKIE = `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

function postRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/co-representantes/invitaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const DATOS = { nombres: "Pablo", apellidos: "Torres", cedula: "1710034065", fechaNacimiento: "1982-04-04", telefono: "0991234567" };
const MENSAJE = { mensaje: "Si el correo es válido, enviaremos la invitación." };

describe("POST /api/co-representantes/invitaciones", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest({ personaIds: [10], correo: "a@b.com", datos: DATOS }));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("translates the body to snake_case and passes the neutral 202 through", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(MENSAJE, 202));

    const response = await POST(postRequest({ personaIds: [10, 11], correo: "a@b.com", datos: DATOS }, COOKIE));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(MENSAJE);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/co-representantes/invitaciones",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          persona_ids: [10, 11],
          correo: "a@b.com",
          datos: { nombres: "Pablo", apellidos: "Torres", cedula: "1710034065", fecha_nacimiento: "1982-04-04", telefono: "0991234567" },
        }),
      }),
    );
  });

  it("forwards the backend's 422 when the data is missing", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "datos requerido" }, 422));

    const response = await POST(postRequest({ personaIds: [10], correo: "a@b.com" }, COOKIE));

    expect(response.status).toBe(422);
  });

  it("forwards the backend's refusal (e.g. 403 for a second guardian) untouched", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Solo el representante principal" }, 403));

    const response = await POST(postRequest({ personaIds: [10], correo: "a@b.com", datos: DATOS }, COOKIE));

    expect(response.status).toBe(403);
  });
});
