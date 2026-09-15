/**
 * Route Handler Tests — PATCH /api/auth/correo (Issue #1245)
 *
 * AUTHENTICATED, unlike its `/auth/verificar-correo/*` siblings: identity
 * resolves from the access-token cookie via `backendFetchAuthed`, same as
 * `PATCH /api/auth/me`. Unlike that route, this one DOES reissue and set new
 * auth cookies (mirrors `POST /api/auth/sesiones/invalidar`) — the
 * backend's `sub` claim is the correo, so the caller must be reauthenticated
 * under the corrected address in the same response.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PATCH } from "../route";
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
  const payload = base64Url(JSON.stringify({ sub: "vieja@cataclub.com", exp }));
  return `${header}.${payload}.sig`;
}

function patchRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/auth/correo", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("PATCH /api/auth/correo", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await PATCH(patchRequest({ correo: "nueva@cataclub.com" }));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 without calling the backend when correo is missing", async () => {
    const access = makeJwt(3600);
    const response = await PATCH(patchRequest({}, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards correo to backend PATCH /auth/correo with the caller's bearer token", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        correo: "nueva@cataclub.com",
        mensaje: "Si el correo está registrado y falta verificarlo, se envió un enlace de verificación",
        accessToken: "new-access",
        refreshToken: "new-refresh",
      }),
    );

    const access = makeJwt(3600);
    await PATCH(patchRequest({ correo: "nueva@cataclub.com" }, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/correo",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ correo: "nueva@cataclub.com" }),
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
  });

  it("returns the corrected correo and message, sets both new cookies, and never echoes a token in the body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        correo: "nueva@cataclub.com",
        mensaje: "Si el correo está registrado y falta verificarlo, se envió un enlace de verificación",
        accessToken: "new-access",
        refreshToken: "new-refresh",
      }),
    );

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest({ correo: "nueva@cataclub.com" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.correo).toBe("nueva@cataclub.com");
    expect(JSON.stringify(body)).not.toMatch(/new-access|new-refresh/);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("new-access");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.httpOnly).toBe(true);
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("new-refresh");
  });

  it("propagates the backend's error status and message, without setting cookies", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "El correo ya está verificado y no puede modificarse por esta vía." }, 400),
    );

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest({ correo: "nueva@cataclub.com" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("El correo ya está verificado y no puede modificarse por esta vía.");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });

  it("returns 502 when the backend response has an unexpected shape", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ unexpected: true }));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest({ correo: "nueva@cataclub.com" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
    );

    expect(response.status).toBe(502);
  });
});
