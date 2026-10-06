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

describe("POST /api/co-representantes/invitaciones", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest({ personaIds: [10], correo: "a@b.com" }));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends a snake_case body and passes the 201 result through", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ estado: "VINCULADO", personaIds: [10] }, 201));

    const response = await POST(postRequest({ personaIds: [10, 11], correo: "a@b.com" }, COOKIE));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ estado: "VINCULADO", personaIds: [10] });
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/co-representantes/invitaciones",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ persona_ids: [10, 11], correo: "a@b.com" }),
      }),
    );
  });

  it("translates the invitee data and keeps the 200 of REQUIERE_DATOS", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ estado: "REQUIERE_DATOS", personaIds: [] }, 200));

    const response = await POST(
      postRequest(
        {
          personaIds: [10],
          correo: "a@b.com",
          datos: { nombres: "Pablo", apellidos: "Torres", cedula: "1710034065", fechaNacimiento: "1982-04-04", telefono: "0991234567" },
        },
        COOKIE,
      ),
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/co-representantes/invitaciones",
      expect.objectContaining({
        body: JSON.stringify({
          persona_ids: [10],
          correo: "a@b.com",
          datos: { nombres: "Pablo", apellidos: "Torres", cedula: "1710034065", fecha_nacimiento: "1982-04-04", telefono: "0991234567" },
        }),
      }),
    );
  });

  it("forwards the backend's refusal (e.g. 403 for a second guardian) untouched", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Solo el representante principal" }, 403));

    const response = await POST(postRequest({ personaIds: [10], correo: "a@b.com" }, COOKIE));

    expect(response.status).toBe(403);
  });
});
