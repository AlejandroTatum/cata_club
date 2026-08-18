/**
 * Route Handler Tests — GET/POST/DELETE /api/personas/[id]/beneficio (issue #398)
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST, DELETE } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

const TOKEN = () => `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;

function getRequest(id: string, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}/beneficio`, {
    method: "GET",
    headers: cookie ? { cookie } : {},
  });
}

function postRequest(id: string, body: unknown, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}/beneficio`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function postRawRequest(id: string, rawBody: string, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}/beneficio`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: rawBody,
  });
}

function deleteRequest(id: string, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}/beneficio`, {
    method: "DELETE",
    headers: cookie ? { cookie } : {},
  });
}

const beneficioResponse = {
  id: 1,
  personaId: 5,
  descuento: { id: 2, nombre: "Beca deportiva", porcentaje: "50.00", monto: null, activo: true },
  asignadoPorPersonaId: 1,
  asignadoEn: "2026-08-01T00:00:00Z",
  retiradoPorPersonaId: null,
  retiradoEn: null,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/personas/[id]/beneficio", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest("5"), { params: { id: "5" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric id without calling the backend", async () => {
    const response = await GET(getRequest("abc", TOKEN()), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls GET /personas/{id}/beneficio and returns the active benefit", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(beneficioResponse));

    const response = await GET(getRequest("5", TOKEN()), { params: { id: "5" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(beneficioResponse);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/beneficio",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns null when the persona has no active benefit", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(null));

    const response = await GET(getRequest("5", TOKEN()), { params: { id: "5" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toBeNull();
  });

  it("relays the backend's 403 with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await GET(getRequest("5", TOKEN()), { params: { id: "5" } });

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("No autorizado");
  });

  it("relays the backend's 404 with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Persona no encontrada" }, 404));

    const response = await GET(getRequest("5", TOKEN()), { params: { id: "5" } });

    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("Persona no encontrada");
  });
});

describe("POST /api/personas/[id]/beneficio", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest("5", { descuentoId: 2 }), { params: { id: "5" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric id without calling the backend", async () => {
    const response = await POST(postRequest("abc", { descuentoId: 2 }, TOKEN()), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON without calling the backend", async () => {
    const response = await POST(postRawRequest("5", "{no-json", TOKEN()), { params: { id: "5" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when descuentoId is missing without calling the backend", async () => {
    const response = await POST(postRequest("5", {}, TOKEN()), { params: { id: "5" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when descuentoId is not a number without calling the backend", async () => {
    const response = await POST(postRequest("5", { descuentoId: "2" }, TOKEN()), { params: { id: "5" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls POST /personas/{id}/beneficio with snake_case body and returns 201", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(beneficioResponse, 201));

    const response = await POST(postRequest("5", { descuentoId: 2 }, TOKEN()), { params: { id: "5" } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(beneficioResponse);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/beneficio",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ descuento_id: 2 }),
      }),
    );
  });

  it("relays the backend's 403 with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await POST(postRequest("5", { descuentoId: 2 }, TOKEN()), { params: { id: "5" } });

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("No autorizado");
  });

  it("relays the backend's 404 with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Descuento no encontrado" }, 404));

    const response = await POST(postRequest("5", { descuentoId: 2 }, TOKEN()), { params: { id: "5" } });

    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("Descuento no encontrado");
  });
});

describe("DELETE /api/personas/[id]/beneficio", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await DELETE(deleteRequest("5"), { params: { id: "5" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric id without calling the backend", async () => {
    const response = await DELETE(deleteRequest("abc", TOKEN()), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls DELETE /personas/{id}/beneficio and returns the retired benefit", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(beneficioResponse));

    const response = await DELETE(deleteRequest("5", TOKEN()), { params: { id: "5" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(beneficioResponse);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/beneficio",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("relays the backend's 403 with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const response = await DELETE(deleteRequest("5", TOKEN()), { params: { id: "5" } });

    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe("No autorizado");
  });

  it("relays the backend's 404 with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "La persona no tiene un beneficio activo" }, 404));

    const response = await DELETE(deleteRequest("5", TOKEN()), { params: { id: "5" } });

    expect(response.status).toBe(404);
    expect((await response.json()).message).toBe("La persona no tiene un beneficio activo");
  });
});
