/**
 * Tests for GET /api/membresias/tarifas.
 *
 * Public BFF proxy for the read-only tariff catalog (issue #394, contract
 * of issue #331) — the enrollment flow needs to show a plan's price before
 * the visitor has any session. Mirrors `api/personas/instituciones`
 * (`backendFetch`, not `proxyToBackend`) for the same reason: this route
 * MUST succeed without any Authorization header or cookie.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tarifasRequest(extraHeaders?: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/membresias/tarifas", { method: "GET", headers: extraHeaders });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/membresias/tarifas", () => {
  it("succeeds with NO Authorization header and NO cookie (permanent public guard)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse([{ categoria: "Adultos", precio: "35.00" }]),
    );

    const response = await GET(tarifasRequest());

    expect(response.status).toBe(200);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  it("forwards the visitor's X-Forwarded-For to the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([]));

    await GET(tarifasRequest({ "x-forwarded-for": "198.51.100.50" }));

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toEqual(expect.stringContaining("/membresias/tarifas"));
    expect(new Headers((init as RequestInit).headers).get("x-forwarded-for")).toBe("198.51.100.50");
  });

  it("proxies GET /membresias/tarifas and forwards the backend's list verbatim", async () => {
    const tarifas = [
      { categoria: "Adultos", precio: "35.00" },
      { categoria: "Infantil", precio: "28.75" },
    ];
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(tarifas));

    const response = await GET(tarifasRequest());
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/tarifas",
      expect.objectContaining({ method: "GET" }),
    );
    expect(response.status).toBe(200);
    expect(body).toEqual(tarifas);
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await GET(tarifasRequest());

    expect(response.status).toBe(503);
  });

  it("returns 502 when the backend responds with a non-ok status", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ message: "Error del servidor" }, 500));

    const response = await GET(tarifasRequest());

    expect(response.status).toBe(502);
  });

  it("returns 502 when the backend response body is not valid JSON", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response("not json", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );

    const response = await GET(tarifasRequest());

    expect(response.status).toBe(502);
  });
});
