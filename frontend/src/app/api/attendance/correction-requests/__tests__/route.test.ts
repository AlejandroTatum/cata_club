/**
 * Route Handler Tests — /api/attendance/correction-requests (QA4 ENT-25)
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.sig`;
}

const cookie = (): string => `${ACCESS_TOKEN_COOKIE}=${makeJwt()}`;

function request(method: string, search = "", body?: unknown, withCookie = true): NextRequest {
  return new NextRequest(`http://localhost/api/attendance/correction-requests${search}`, {
    method,
    headers: {
      ...(withCookie ? { cookie: cookie() } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/attendance/correction-requests", () => {
  it("returns 401 without an access token", async () => {
    const response = await GET(request("GET", "", undefined, false));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards only the known filters", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([]));

    const response = await GET(request("GET", "?estado=PENDIENTE&horario_id=3&fecha=2026-09-01&otro=x"));

    expect(response.status).toBe(200);
    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toBe(
      "http://localhost:8000/api/v1/asistencias/solicitudes-correccion?estado=PENDIENTE&horario_id=3&fecha=2026-09-01",
    );
  });

  it("relays a backend error", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No." }, 403));
    const response = await GET(request("GET"));
    expect(response.status).toBe(403);
  });
});

describe("POST /api/attendance/correction-requests", () => {
  it("returns 401 without an access token", async () => {
    const response = await POST(request("POST", "", { asistenciaId: 1 }, false));
    expect(response.status).toBe(401);
  });

  it("rejects a malformed body without calling the backend", async () => {
    const response = await POST(request("POST", "", { asistenciaId: "x", estado: "absent", motivo: "m" }));
    expect(response.status).toBe(400);
    const sinMotivo = await POST(request("POST", "", { asistenciaId: 1, estado: "absent", motivo: "  " }));
    expect(sinMotivo.status).toBe(400);
    const estadoRaro = await POST(request("POST", "", { asistenciaId: 1, estado: "nope", motivo: "m" }));
    expect(estadoRaro.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("translates the body to the backend contract and answers 201", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 5 }, 201));

    const response = await POST(request("POST", "", { asistenciaId: 9, estado: "absent", motivo: "Faltó." }));

    expect(response.status).toBe(201);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/api/v1/asistencias/solicitudes-correccion");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      asistencia_id: 9,
      estado_solicitado: "AUSENTE",
      motivo: "Faltó.",
    });
  });
});
