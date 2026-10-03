/**
 * Route Handler Tests — POST /api/auth/contrasenia/cambiar
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

function cambiarRequest(body: unknown, cookie = `${ACCESS_TOKEN_COOKIE}=old-access`): NextRequest {
  return new NextRequest("http://localhost/api/auth/contrasenia/cambiar", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const VALID = { contrasenia_actual: "claveActual123", nueva_contrasenia: "claveNueva456" };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/auth/contrasenia/cambiar", () => {
  it("returns 401 with no fetch call when there is no access-token cookie", async () => {
    const response = await POST(cambiarRequest(VALID, ""));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 without calling the backend when a field is missing", async () => {
    const response = await POST(cambiarRequest({ contrasenia_actual: "claveActual123" }));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards both passwords with the caller's bearer token", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", token_type: "bearer" }),
    );

    await POST(cambiarRequest(VALID));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/contrasenia/cambiar",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer old-access" }),
        body: JSON.stringify(VALID),
      }),
    );
  });

  it("sets both new cookies and never echoes a token in the body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", token_type: "bearer" }),
    );

    const response = await POST(cambiarRequest(VALID));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(JSON.stringify(json)).not.toMatch(/new-access|new-refresh/);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("new-access");
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("new-refresh");
  });

  it("propagates the backend's message on a rejected change, without setting cookies", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "La contraseña actual es incorrecta.", message: "La contraseña actual es incorrecta.", mensaje_seguro: true }, 400),
    );

    const response = await POST(cambiarRequest(VALID));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.message).toBe("La contraseña actual es incorrecta.");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });

  it("returns 502 when the backend response has an unexpected shape", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ unexpected: true }));

    const response = await POST(cambiarRequest(VALID));

    expect(response.status).toBe(502);
  });
});
