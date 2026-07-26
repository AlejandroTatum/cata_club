/**
 * Route Handler Tests — POST /api/auth/sesiones/invalidar
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

function invalidarRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/auth/sesiones/invalidar", {
    method: "POST",
    headers: cookie ? { cookie } : {},
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

describe("POST /api/auth/sesiones/invalidar", () => {
  it("returns 401 with no fetch call when there is no access-token cookie", async () => {
    const response = await POST(invalidarRequest());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies to the backend with the caller's bearer token", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", token_type: "bearer" }),
    );

    await POST(invalidarRequest(`${ACCESS_TOKEN_COOKIE}=old-access`));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/sesiones/invalidar",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer old-access" }),
      }),
    );
  });

  it("sets BOTH new cookies from the backend response and never echoes a token in the body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", token_type: "bearer" }),
    );

    const response = await POST(invalidarRequest(`${ACCESS_TOKEN_COOKIE}=old-access`));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(JSON.stringify(json)).not.toMatch(/new-access|new-refresh/);
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("new-access");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.httpOnly).toBe(true);
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("new-refresh");
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.httpOnly).toBe(true);
  });

  it("propagates a non-OK backend response as a user-facing error, without setting cookies", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ message: "Token inválido o expirado" }, 401));

    const response = await POST(invalidarRequest(`${ACCESS_TOKEN_COOKIE}=stale-access`));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.message).toBe("Token inválido o expirado");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });

  it("returns 502 when the backend response has an unexpected shape", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ unexpected: true }));

    const response = await POST(invalidarRequest(`${ACCESS_TOKEN_COOKIE}=old-access`));

    expect(response.status).toBe(502);
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await POST(invalidarRequest(`${ACCESS_TOKEN_COOKIE}=old-access`));

    expect(response.status).toBe(503);
  });
});
