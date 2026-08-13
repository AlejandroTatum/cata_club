/**
 * Tests for POST /api/auth/restablecer-contrasenia.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function restablecerRequest(body: unknown, extraHeaders?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/auth/restablecer-contrasenia", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
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

describe("POST /api/auth/restablecer-contrasenia", () => {
  it("returns 400 with no fetch call when the token is missing", async () => {
    const response = await POST(restablecerRequest({ nueva_contrasenia: "12345678" }));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the visitor's X-Forwarded-For to the backend (issue #235)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(emptyResponse(204));

    await POST(restablecerRequest({ token: "tok", nueva_contrasenia: "12345678" }, { "x-forwarded-for": "198.51.100.70" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/restablecer-contrasenia",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Forwarded-For": "198.51.100.70" }) }),
    );
  });

  it("returns 400 with no fetch call when the new password is under 8 characters", async () => {
    const response = await POST(restablecerRequest({ token: "abc", nueva_contrasenia: "short" }));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 200 with a small JSON body on backend success (204), not a bare 204", async () => {
    // The shared client (src/services/api.ts's `request()`) always calls
    // response.json() on a 2xx response, which throws on an empty body —
    // this route must never pass a raw 204 straight through.
    vi.mocked(global.fetch).mockResolvedValueOnce(emptyResponse(204));

    const response = await POST(restablecerRequest({ token: "valid-token", nueva_contrasenia: "12345678" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ success: true });
  });

  it("calls the backend with token and nueva_contrasenia in a JSON body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(emptyResponse(204));

    await POST(restablecerRequest({ token: "valid-token", nueva_contrasenia: "12345678" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/restablecer-contrasenia",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "valid-token", nueva_contrasenia: "12345678" }),
      }),
    );
  });

  it("translates an invalid/expired token (backend 400) into a 400 with a readable message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "El enlace de recuperación es inválido o expiró" }, 400),
    );

    const response = await POST(restablecerRequest({ token: "expired", nueva_contrasenia: "12345678" }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.message).toBe("El enlace de recuperación es inválido o expiró");
  });

  it("translates a 429 from the backend into a rate_limited error", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(emptyResponse(429));

    const response = await POST(restablecerRequest({ token: "valid-token", nueva_contrasenia: "12345678" }));

    expect(response.status).toBe(429);
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await POST(restablecerRequest({ token: "valid-token", nueva_contrasenia: "12345678" }));

    expect(response.status).toBe(503);
  });
});
