/**
 * Tests for POST /api/auth/recuperar-contrasenia.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function recuperarRequest(body: unknown, extraHeaders?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/auth/recuperar-contrasenia", {
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

describe("POST /api/auth/recuperar-contrasenia", () => {
  it("returns 400 with no fetch call when correo is missing", async () => {
    const response = await POST(recuperarRequest({}));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the visitor's X-Forwarded-For to the backend (issue #235)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ mensaje: "ok" }));

    await POST(recuperarRequest({ correo: "ana@cataclub.com" }, { "x-forwarded-for": "198.51.100.60" }));

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/v1/auth/recuperar-contrasenia");
    expect(new Headers((init as RequestInit).headers).get("x-forwarded-for")).toBe("198.51.100.60");
  });

  it("forwards the same success message the backend returns, regardless of whether the email exists", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ mensaje: "Si el correo está registrado, se envió un enlace de recuperación" }),
    );

    const response = await POST(recuperarRequest({ correo: "admin@cataclub.local" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ mensaje: "Si el correo está registrado, se envió un enlace de recuperación" });
  });

  it("calls the backend with the correo in a JSON body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ mensaje: "ok" }));

    await POST(recuperarRequest({ correo: "admin@cataclub.local" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/recuperar-contrasenia",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ correo: "admin@cataclub.local" }),
      }),
    );
  });

  it("translates a 429 from the backend into a rate_limited error", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}, 429));

    const response = await POST(recuperarRequest({ correo: "admin@cataclub.local" }));

    expect(response.status).toBe(429);
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await POST(recuperarRequest({ correo: "admin@cataclub.local" }));

    expect(response.status).toBe(503);
  });
});
