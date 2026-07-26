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

function institucionesRequest(): NextRequest {
  return new NextRequest("http://localhost/api/personas/instituciones", { method: "GET" });
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
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([{ id: 1, nombre: "Colegio Central" }]));

    const response = await GET(institucionesRequest());

    expect(response.status).toBe(200);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("proxies GET /personas/instituciones and forwards the backend's list", async () => {
    const instituciones = [
      { id: 1, nombre: "Colegio Central", tipoEscuela: "PUBLICA" },
      { id: 2, nombre: "Instituto Norte", tipoEscuela: "PRIVADA" },
    ];
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(instituciones));

    const response = await GET(institucionesRequest());
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/personas/instituciones",
      expect.objectContaining({ method: "GET" }),
    );
    expect(response.status).toBe(200);
    expect(body).toEqual(instituciones);
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
