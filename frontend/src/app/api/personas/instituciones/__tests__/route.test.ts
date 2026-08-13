/**
 * Tests for GET /api/personas/instituciones.
 *
 * Public BFF proxy for the school selector at `student/enroll` — that page
 * renders with no `ProtectedRoute` wrapper, so this route MUST succeed
 * without any Authorization header or cookie. It follows the
 * `auth/recuperar-contrasenia` pattern (`backendFetch`, not `proxyToBackend`)
 * for exactly that reason.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function institucionesRequest(extraHeaders?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/personas/instituciones", { method: "GET", headers: extraHeaders });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/personas/instituciones", () => {
  it("succeeds with NO Authorization header and NO cookie (permanent public guard)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ items: [{ id: 1, nombre: "Colegio Central" }], total: 1, skip: 0, limit: 200 }),
    );

    const response = await GET(institucionesRequest());

    expect(response.status).toBe(200);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("forwards the visitor's X-Forwarded-For to the backend (issue #235)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ items: [], total: 0, skip: 0, limit: 200 }),
    );

    await GET(institucionesRequest({ "x-forwarded-for": "198.51.100.50" }));

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toEqual(expect.stringContaining("/personas/instituciones"));
    expect(new Headers((init as RequestInit).headers).get("x-forwarded-for")).toBe("198.51.100.50");
  });

  it("proxies GET /personas/instituciones and forwards the backend's paginated envelope", async () => {
    const envelope = {
      items: [
        { id: 1, nombre: "Colegio Central", tipoEscuela: "PUBLICA" },
        { id: 2, nombre: "Instituto Norte", tipoEscuela: "PRIVADA" },
      ],
      total: 2,
      skip: 0,
      limit: 200,
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(envelope));

    const response = await GET(institucionesRequest());
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/personas/instituciones",
      expect.objectContaining({ method: "GET" }),
    );
    expect(response.status).toBe(200);
    expect(body).toEqual(envelope);
  });

  it("forwards skip/limit query params to the backend, unchanged", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [], total: 0, skip: 200, limit: 200 }));

    const request = new NextRequest(
      "http://localhost/api/personas/instituciones?skip=200&limit=200",
      { method: "GET" },
    );
    await GET(request);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/personas/instituciones?skip=200&limit=200",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("issues no query string when skip/limit are absent (backend applies its own defaults)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ items: [], total: 0, skip: 0, limit: 200 }));

    await GET(institucionesRequest());

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/personas/instituciones",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await GET(institucionesRequest());

    expect(response.status).toBe(503);
  });

  it("returns 502 when the backend responds with a non-ok status", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ message: "Error del servidor" }, 500));

    const response = await GET(institucionesRequest());

    expect(response.status).toBe(502);
  });

  it("returns 502 when the backend response body is not valid JSON", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response("not json", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );

    const response = await GET(institucionesRequest());

    expect(response.status).toBe(502);
  });
});
