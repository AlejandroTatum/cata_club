/**
 * Route Handler Tests — POST /api/membresias/[id]/cambiar-plan (issue #400, criterio 1)
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
  return new NextRequest(`http://localhost/api/membresias/${membresiaId}/cambiar-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: JSON.stringify(body),
  });
}

function postRawRequest(membresiaId: string, rawBody: string): NextRequest {
  return new NextRequest(`http://localhost/api/membresias/${membresiaId}/cambiar-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: rawBody,
  });
}

const membresiaConPlanNuevo = {
  id: 3,
  estado: "ACTIVA",
  montoAplicado: "45.00",
  fechaActivacion: "2026-01-01T00:00:00Z",
  personaId: 2,
  tipoMembresiaId: 7,
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

describe("POST /api/membresias/[id]/cambiar-plan", () => {
  it("translates nuevoTipoMembresiaId to nuevo_tipo_membresia_id and returns the updated membresía", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(membresiaConPlanNuevo));

    const response = await POST(postRequest("3", { nuevoTipoMembresiaId: 7 }), { params: { id: "3" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(membresiaConPlanNuevo);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/3/cambiar-plan");
    expect(JSON.parse(String(init.body))).toEqual({ nuevo_tipo_membresia_id: 7 });
  });

  it("rejects a non-numeric membresia id with 400 without calling the backend", async () => {
    const response = await POST(postRequest("abc", { nuevoTipoMembresiaId: 7 }), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400 without calling the backend", async () => {
    const response = await POST(postRawRequest("3", "{no-json"), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a missing/non-numeric nuevoTipoMembresiaId with 400 without calling the backend", async () => {
    const response = await POST(postRequest("3", { nuevoTipoMembresiaId: "7" }), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's 400 (e.g. mismo tipo) with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "La membresía ya tiene asignado ese tipo de membresía." }, 400),
    );

    const response = await POST(postRequest("3", { nuevoTipoMembresiaId: 5 }), { params: { id: "3" } });

    expect(response.status).toBe(400);
  });

  it("relays the backend's 403 when the caller is not an administrator", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await POST(postRequest("3", { nuevoTipoMembresiaId: 7 }), { params: { id: "3" } });

    expect(response.status).toBe(403);
  });
});
