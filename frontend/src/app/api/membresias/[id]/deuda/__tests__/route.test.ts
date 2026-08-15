/**
 * Route Handler Tests — GET /api/membresias/:id/deuda (issue #284)
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
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

function getRequest(membresiaId: string, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/${membresiaId}/deuda`, {
    headers: cookie ? { cookie } : {},
  });
}

const deuda = {
  mesesAdeudados: 4,
  ultimaCoberturaFin: "2026-03-31",
  montoMensual: 30,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/membresias/[id]/deuda", () => {
  it("proxies the derived debt and forwards it as JSON", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(deuda));

    const response = await GET(getRequest("9", `${ACCESS_TOKEN_COOKIE}=token`), { params: { id: "9" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(deuda);
    const [url] = fetchMock.mock.calls[0] as [RequestInfo | URL];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/9/deuda");
  });

  it("rejects a non-numeric id with 400 without calling the backend", async () => {
    const response = await GET(getRequest("abc"), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("propagates the backend 403 (admin-only surface)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "Permisos insuficientes" }, 403),
    );

    const response = await GET(
      getRequest("9", `${ACCESS_TOKEN_COOKIE}=token`),
      { params: { id: "9" } },
    );

    expect(response.status).toBe(403);
  });
});
