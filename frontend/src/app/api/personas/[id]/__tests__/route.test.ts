/**
 * Route Handler Tests — PATCH /api/personas/[id]
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

function patchRequest(id: string, body: unknown, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const personaResponse = {
  id: 5,
  nombres: "Ana",
  apellidos: "López",
  cedula: "1710034065",
  fechaNacimiento: "1990-05-14",
  telefono: "0991234567",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("PATCH /api/personas/[id]", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await PATCH(patchRequest("5", { telefonoContacto: "0998765432" }), { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /personas/{id} with the body and Authorization: Bearer", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest("5", { telefonoContacto: "0998765432" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(personaResponse);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ telefonoContacto: "0998765432" }),
      }),
    );
  });

  it("propagates the backend's 403", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest("5", { telefonoContacto: "0998765432" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(403);
  });
});
