/**
 * Route Handler Tests — POST /api/personas/me/representados (issue #1318)
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "alumno@cataclub.test", exp }));
  return `${header}.${payload}.sig`;
}

function postRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/personas/me/representados", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validPayload = {
  nombres: "Luis",
  apellidos: "Reyes",
  cedula: "1712345678",
  fechaNacimiento: "2015-06-15",
  telefono: "0991234567",
};

const backendResponse = {
  representado: {
    id: 10, nombres: "Luis", apellidos: "Reyes", cedula: "1712345678",
    fechaNacimiento: "2015-06-15", telefono: "0991234567", representanteId: 9,
  },
  accessToken: "new-access",
  refreshToken: "new-refresh",
  tokenType: "bearer",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/personas/me/representados", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest(validPayload));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const access = makeJwt(3600);
    const request = new NextRequest("http://localhost/api/personas/me/representados", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${access}` },
      body: "not-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls POST /personas/me/representados with a snake_case body — no id in the path", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(backendResponse, 201));

    const access = makeJwt(3600);
    await POST(postRequest(validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/me/representados",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          nombres: "Luis",
          apellidos: "Reyes",
          cedula: "1712345678",
          fecha_nacimiento: "2015-06-15",
          telefono: "0991234567",
        }),
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
  });

  it("returns only { representado } to client JS and rotates both auth cookies", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(backendResponse, 201));

    const access = makeJwt(3600);
    const response = await POST(postRequest(validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ representado: backendResponse.representado });
    expect(JSON.stringify(body)).not.toMatch(/new-access|new-refresh/);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("new-access");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.httpOnly).toBe(true);
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("new-refresh");
  });

  it("propagates the backend's error status and message, without setting cookies", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Debe ser mayor de edad para agregar un dependiente y pasar a ser representante." }, 400),
    );

    const access = makeJwt(3600);
    const response = await POST(postRequest(validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Debe ser mayor de edad para agregar un dependiente y pasar a ser representante.");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });

  it("propagates a 403 for a staff account (ADMINISTRADOR/ENTRENADOR)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Permisos insuficientes para esta operación" }, 403),
    );

    const access = makeJwt(3600);
    const response = await POST(postRequest(validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(403);
  });

  it("returns 502 when the backend response has an unexpected shape", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ unexpected: true }, 201));

    const access = makeJwt(3600);
    const response = await POST(postRequest(validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(502);
  });
});
