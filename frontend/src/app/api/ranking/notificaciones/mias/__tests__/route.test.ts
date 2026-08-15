/**
 * Tests for GET /api/ranking/notificaciones/mias.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/ranking/notificaciones/mias", {
    headers: cookie ? { cookie } : {},
  });
}

const notificacion = {
  id: 1,
  tipo: "MIEMBRESIA_VENCIMIENTO_PROXIMO",
  mensaje: "Tu membresía vence pronto.",
  leida: false,
  fechaCreacion: "2026-07-19T10:00:00Z",
  entidadRelacionadaId: 5,
};

const paginatedBody = {
  items: [notificacion],
  total: 1,
  skip: 0,
  limit: 20,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/ranking/notificaciones/mias", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the token as Bearer and passes through the paginated envelope unmodified", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(paginatedBody));

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=abc123`));
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/ranking/notificaciones/mias",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer abc123" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(body).toEqual(paginatedBody);
  });

  it("propagates a backend error status and message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "Sesión inválida." }, 401),
    );

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=abc123`));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.message).toBe("Sesión inválida.");
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=abc123`));

    expect(response.status).toBe(503);
  });

  it("returns 504 when the request times out", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=abc123`));

    expect(response.status).toBe(504);
  });
});
