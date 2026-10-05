/**
 * Route Handler Tests — POST /api/personas/entrenadores (#1575)
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

const COOKIE = `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

const VALID_BODY = {
  nombres: "Marta",
  apellidos: "Zambrano",
  cedula: "1710034065",
  fechaNacimiento: "1988-03-02",
  correo: "marta@cataclub.com",
  telefono: "0991234567",
};

function postRequest(body: unknown, cookie = COOKIE): NextRequest {
  return new NextRequest("http://localhost/api/personas/entrenadores", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/personas/entrenadores", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest(VALID_BODY, ""));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const response = await POST(postRequest("not-json"));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(Object.keys(VALID_BODY))("returns 400 when %s is missing", async (field) => {
    const response = await POST(postRequest({ ...VALID_BODY, [field]: "" }));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the payload in snake_case and answers the new persona id", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 77 }, 201));

    const response = await POST(postRequest(VALID_BODY));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ personaId: 77 });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/personas/entrenadores",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          nombres: "Marta",
          apellidos: "Zambrano",
          cedula: "1710034065",
          fecha_nacimiento: "1988-03-02",
          correo: "marta@cataclub.com",
          telefono: "0991234567",
        }),
      }),
    );
  });

  it("relays the backend's duplicate-identity message and status", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Ya existe una persona o una cuenta con esa cédula o ese correo." }, 400),
    );

    const response = await POST(postRequest(VALID_BODY));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("Ya existe una persona o una cuenta");
  });

  it("relays a 403 for a non-admin caller", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Sin permiso" }, 403));

    const response = await POST(postRequest(VALID_BODY));

    expect(response.status).toBe(403);
  });
});
