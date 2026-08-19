/**
 * Route Handler Tests — POST /api/membresias/[id]/suspender (issue #400, criterio 3)
 *
 * Mocks the backend via vi.spyOn(global, "fetch"). Same shape as
 * membresias/[id]/aplicar-beneficio/__tests__/route.test.ts.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function postRequest(membresiaId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/${membresiaId}/suspender`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: JSON.stringify(body),
  });
}

function postRawRequest(membresiaId: string, rawBody: string): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/${membresiaId}/suspender`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: rawBody,
  });
}

const membresiaSuspendida = {
  id: 3,
  estado: "SUSPENDIDA",
  montoAplicado: "30.00",
  fechaActivacion: "2026-01-01T00:00:00Z",
  personaId: 2,
  tipoMembresiaId: 5,
  esGratuidadFamiliar: false,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/membresias/[id]/suspender", () => {
  it("proxies motivo and returns the suspended membresía", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(membresiaSuspendida));

    const response = await POST(postRequest("3", { motivo: "Ausencia prolongada" }), { params: { id: "3" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(membresiaSuspendida);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/3/suspender");
    expect(JSON.parse(String(init.body))).toEqual({ motivo: "Ausencia prolongada" });
  });

  it("translates fechaEfectiva to fecha_efectiva when present", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(membresiaSuspendida));

    await POST(
      postRequest("3", { motivo: "Ausencia", fechaEfectiva: "2026-08-01T00:00:00Z" }),
      { params: { id: "3" } },
    );

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      motivo: "Ausencia",
      fecha_efectiva: "2026-08-01T00:00:00Z",
    });
  });

  it("rejects a non-numeric membresia id with 400 without calling the backend", async () => {
    const response = await POST(postRequest("abc", { motivo: "x" }), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400 without calling the backend", async () => {
    const response = await POST(postRawRequest("3", "{no-json"), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing motivo with 400 without calling the backend", async () => {
    const response = await POST(postRequest("3", {}), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects an empty motivo with 400 without calling the backend", async () => {
    const response = await POST(postRequest("3", { motivo: "" }), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's 400 (e.g. origen inválido) with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "Solo una membresía activa puede suspenderse." }, 400),
    );

    const response = await POST(postRequest("3", { motivo: "x" }), { params: { id: "3" } });

    expect(response.status).toBe(400);
  });

  it("relays the backend's 403 when the caller is not an administrator", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await POST(postRequest("3", { motivo: "x" }), { params: { id: "3" } });

    expect(response.status).toBe(403);
  });
});
