/**
 * Route Handler Tests — POST /api/auth/reautenticar (password step-up, #1653 S5)
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
  return `${header}.${base64Url(JSON.stringify({ sub: "1", exp }))}.sig`;
}

function postRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/auth/reautenticar", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const authed = `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}; ${REFRESH_TOKEN_COOKIE}=refresh-token`;

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/auth/reautenticar", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest({ contrasenia: "x" }));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a body without a password before spending a backend call", async () => {
    const response = await POST(postRequest({}, authed));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the password once to /auth/reautenticar and returns camelCase", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ reautenticado_hasta: "2026-10-12T12:10:00Z" }));

    const response = await POST(postRequest({ contrasenia: "claveAdmin123" }, authed));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reautenticadoHasta: "2026-10-12T12:10:00Z" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/reautenticar",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ contrasenia: "claveAdmin123" }) }),
    );
  });

  it("relays a wrong password as a 400 and never replays it against the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse(
        { detail: "Contraseña incorrecta", message: "Contraseña incorrecta", mensaje_seguro: true, codigo: "contrasenia_incorrecta" },
        401,
      ),
    );

    const response = await POST(postRequest({ contrasenia: "mala" }, authed));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ message: "Contraseña incorrecta", mensaje_seguro: true, codigo: "contrasenia_incorrecta" });
    // No refresh + replay: a second attempt would count twice toward the lockout.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("relays the login cooldown as a 429 with its message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse(
        { detail: "Demasiados intentos fallidos.", message: "Demasiados intentos fallidos.", mensaje_seguro: true, codigo: "login_enfriamiento" },
        429,
      ),
    );

    const response = await POST(postRequest({ contrasenia: "x" }, authed));

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ codigo: "login_enfriamiento", mensaje_seguro: true });
  });

  it("does not turn another 401 (a dead session) into a 400", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Token inválido o expirado" }, 401));

    const response = await POST(postRequest({ contrasenia: "x" }, authed));

    expect(response.status).toBe(401);
  });
});
