/**
 * Tests for POST /api/auth/login.
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
 * Covers: form-encoding to the backend, HttpOnly cookie attributes, that
 * tokens never appear in the JSON body, and distinct bad-credentials /
 * backend-unreachable failure handling.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../login/route";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function loginRequest(body: unknown, extraHeaders?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

const meBody = { correo: "admin@cataclub.com", personaId: 1, nombres: "Ana", apellidos: "Torres", roles: ["ADMINISTRADOR"] };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/auth/login", () => {
  it("re-encodes the JSON body as application/x-www-form-urlencoded for FastAPI", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "a", refresh_token: "r", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse(meBody));

    await POST(loginRequest({ email: "admin@cataclub.com", password: "admin123" }));

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/auth/login",
      expect.objectContaining({
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "username=admin%40cataclub.com&password=admin123",
      }),
    );
  });

  it("forwards the visitor's X-Forwarded-For to the backend (issue #235)", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "a", refresh_token: "r", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse(meBody));

    await POST(loginRequest({ email: "admin@cataclub.com", password: "admin123" }, { "x-forwarded-for": "198.51.100.30" }));

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/auth/login",
      expect.objectContaining({ headers: expect.anything() }),
    );
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(new Headers((init as RequestInit).headers).get("x-forwarded-for")).toBe("198.51.100.30");
  });

  it("sets both cookies as HttpOnly, SameSite=Lax on success", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "a", refresh_token: "r", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse(meBody));

    const response = await POST(loginRequest({ email: "admin@cataclub.com", password: "admin123" }));

    expect(response.status).toBe(200);
    const access = response.cookies.get(ACCESS_TOKEN_COOKIE);
    const refresh = response.cookies.get(REFRESH_TOKEN_COOKIE);
    expect(access?.value).toBe("a");
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe("lax");
    expect(refresh?.value).toBe("r");
    expect(refresh?.httpOnly).toBe(true);
  });

  it("never returns a token in the JSON body", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "super-secret-a", refresh_token: "super-secret-r", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse(meBody));

    const response = await POST(loginRequest({ email: "admin@cataclub.com", password: "admin123" }));
    const json = await response.json();

    expect(JSON.stringify(json)).not.toMatch(/super-secret/);
    expect(json).toEqual({
      user: { id: "1", name: "Ana Torres", email: "admin@cataclub.com", role: "admin", representanteId: null, fotoUrl: null },
      roles: ["ADMINISTRADOR"],
      correoVerificado: true,
      altaPresencialCompletada: true,
      loggedInAt: expect.any(String),
    });
  });

  it("returns 401 with a controlled message on bad credentials", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Incorrect username or password" }, 401));

    const response = await POST(loginRequest({ email: "admin@cataclub.com", password: "wrong" }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe("invalid_credentials");
    expect(JSON.stringify(json)).not.toMatch(/Incorrect username or password/);
  });

  it("returns 503 (not a raw error) when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await POST(loginRequest({ email: "admin@cataclub.com", password: "admin123" }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.error).toBe("backend_unavailable");
  });

  it("returns 400 when the request body is missing required fields", async () => {
    const response = await POST(loginRequest({ email: "admin@cataclub.com" }));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const request = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
  });

  it("does not set cookies when login fails", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}, 401));

    const response = await POST(loginRequest({ email: "admin@cataclub.com", password: "wrong" }));

    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Issue #762 — a multi-role account has no session to issue.
  //
  // The credentials are right and the backend answered; what fails is the
  // account, so this is neither a 401 (the password was fine) nor a 500 (the
  // deployment is fine). 409 is the same answer the database gives the same
  // invariant since #785, which raises SQLSTATE 23505 and surfaces as a 409.
  // -------------------------------------------------------------------------

  it("returns 409 for an account that still holds more than one role", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "a", refresh_token: "r", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ ...meBody, roles: ["ADMINISTRADOR", "ENTRENADOR"] }));

    const response = await POST(loginRequest({ email: "admin@cataclub.com", password: "admin123" }));
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toBe("role_conflict");
    // The message names the problem and the way out, and names no role: the
    // point is that the frontend did not pick one.
    expect(json.message).toMatch(/rol/i);
  });

  it("sets no cookies for a multi-role account, so no half-session survives", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "a", refresh_token: "r", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ ...meBody, roles: ["ENTRENADOR", "ALUMNO"] }));

    const response = await POST(loginRequest({ email: "admin@cataclub.com", password: "admin123" }));

    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });
});
