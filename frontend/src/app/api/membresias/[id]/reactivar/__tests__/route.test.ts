/**
 * Route Handler Tests — POST /api/membresias/[id]/reactivar (issue #400, criterio 3)
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
  return new NextRequest(`http://localhost/api/membresias/${membresiaId}/reactivar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: JSON.stringify(body),
  });
}

const membresiaActiva = {
  id: 3,
  estado: "ACTIVA",
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

describe("POST /api/membresias/[id]/reactivar", () => {
  it("proxies motivo and returns the reactivated membresía", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(membresiaActiva));

    const response = await POST(postRequest("3", { motivo: "Regresa al club" }), { params: { id: "3" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(membresiaActiva);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/3/reactivar");
    expect(JSON.parse(String(init.body))).toEqual({ motivo: "Regresa al club" });
  });

  it("rejects a non-numeric membresia id with 400 without calling the backend", async () => {
    const response = await POST(postRequest("abc", { motivo: "x" }), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing motivo with 400 without calling the backend", async () => {
    const response = await POST(postRequest("3", {}), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's 400 (e.g. origen inválido) with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "Solo una membresía suspendida puede reactivarse." }, 400),
    );

    const response = await POST(postRequest("3", { motivo: "x" }), { params: { id: "3" } });

    expect(response.status).toBe(400);
  });

  it("relays the backend's 403 when the caller is not an administrator", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await POST(postRequest("3", { motivo: "x" }), { params: { id: "3" } });

    expect(response.status).toBe(403);
  });

  // Issue #400 (entrega 08): pin the exact status the backend returns for
  // 409/422, not a genericized 500 — a route that swallows the real status
  // here would still 200 or 500 in these tests without this assertion.
  it("relays the backend's 409 as-is", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Conflicto" }, 409));

    const response = await POST(postRequest("3", { motivo: "x" }), { params: { id: "3" } });

    expect(response.status).toBe(409);
  });

  it("relays the backend's 422 as-is", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Entidad no procesable" }, 422));

    const response = await POST(postRequest("3", { motivo: "x" }), { params: { id: "3" } });

    expect(response.status).toBe(422);
  });
});
