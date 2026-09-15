/**
 * Route Handler Tests — POST /api/membresias/propia (issue #1132)
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
 * Same shape as membresias/[id]/aplicar-beneficio/__tests__/route.test.ts.
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

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/membresias/propia", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: JSON.stringify(body),
  });
}

function postRawRequest(rawBody: string): NextRequest {
  return new NextRequest("http://localhost/api/membresias/propia", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=token` },
    body: rawBody,
  });
}

const membresiaPropia = {
  id: 55,
  estado: "INACTIVA",
  montoAplicado: "35.00",
  fechaActivacion: "2026-08-18T10:00:00.000000",
  personaId: 9,
  tipoMembresiaId: 3,
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

describe("POST /api/membresias/propia", () => {
  it("proxies tipoMembresiaId (snake_case on the wire) and returns the born-INACTIVA membership with 201", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(membresiaPropia, 201));

    const response = await POST(postRequest({ tipoMembresiaId: 3 }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(membresiaPropia);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toBe("http://localhost:8000/api/v1/membresias/propia");
    expect(init.method).toBe("POST");
    // No `personaId` field exists on this body — there is nothing here for a
    // caller to point at another Persona with.
    expect(JSON.parse(String(init.body))).toEqual({ tipo_membresia_id: 3 });
  });

  it("rejects invalid JSON with 400 without calling the backend", async () => {
    const response = await POST(postRawRequest("{no-json"));

    expect(response.status).toBe(400);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("rejects a missing/non-numeric tipoMembresiaId with 400 without calling the backend", async () => {
    const response = await POST(postRequest({ tipoMembresiaId: "3" }));

    expect(response.status).toBe(400);
    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
  });

  it("ignores an extraneous personaId in the body — never forwarded to the backend", async () => {
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(membresiaPropia, 201));

    await POST(postRequest({ tipoMembresiaId: 3, personaId: 999 }));

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ tipo_membresia_id: 3 });
  });

  it("relays the backend's 400 (e.g. ya tiene una membresía activa) with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Ya existe una membresía activa o suspendida para esta persona." }, 400),
    );

    const response = await POST(postRequest({ tipoMembresiaId: 3 }));

    expect(response.status).toBe(400);
  });

  it("relays the backend's 401 when the caller is unauthenticated", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autenticado" }, 401));

    const response = await POST(postRequest({ tipoMembresiaId: 3 }));

    expect(response.status).toBe(401);
  });

  it("relays the backend's 404 (unknown tipo_membresia_id) as-is", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Tipo de membresía no encontrado" }, 404));

    const response = await POST(postRequest({ tipoMembresiaId: 999 }));

    expect(response.status).toBe(404);
  });
});
