/**
 * Tests for PATCH /api/ranking/notificaciones/leer-todas.
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

function patchRequest(cookie: string): NextRequest {
  return new NextRequest("http://localhost/api/ranking/notificaciones/leer-todas", {
    method: "PATCH",
    headers: { cookie },
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

describe("PATCH /api/ranking/notificaciones/leer-todas", () => {
  it("returns 401 when the access-token cookie is missing", async () => {
    const response = await PATCH(patchRequest(""));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the token as Bearer, without a request body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ actualizadas: 7 }));

    const response = await PATCH(patchRequest(`${ACCESS_TOKEN_COOKIE}=abc123`));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/ranking/notificaciones/leer-todas",
      expect.objectContaining({
        method: "PATCH",
        body: undefined,
        headers: expect.objectContaining({ Authorization: "Bearer abc123" }),
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.actualizadas).toBe(7);
  });

  it("propagates a non-OK backend response verbatim", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "El servidor respondió con un error (500)." }, 500),
    );

    const response = await PATCH(patchRequest(`${ACCESS_TOKEN_COOKIE}=abc123`));

    expect(response.status).toBe(500);
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await PATCH(patchRequest(`${ACCESS_TOKEN_COOKIE}=abc123`));

    expect(response.status).toBe(503);
  });
});
