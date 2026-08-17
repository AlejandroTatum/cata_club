/**
 * Route Handler Tests — GET /api/fichas-medicas/persona/[id]/emergencia
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

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

function getRequest(personaId: string, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/fichas-medicas/persona/${personaId}/emergencia`, {
    headers: cookie ? { cookie } : {},
  });
}

const fichaEmergencia = {
  alumnoNombreCompleto: "Iker Solís",
  tipoSangre: "O_POSITIVO",
  alergias: "Polen",
  contactoEmergencia: "Marta Solís",
  telefonoEmergencia: "0987654321",
  representanteNombreCompleto: "Marta Solís",
  representanteTelefono: "0987654321",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/fichas-medicas/persona/[id]/emergencia", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest("5"), { params: { id: "5" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 without calling the backend when the id is not a number", async () => {
    const access = makeJwt(3600);
    const response = await GET(getRequest("abc", `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { id: "abc" },
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /fichas-medicas/persona/{id}/emergencia with Authorization: Bearer and returns the payload as-is", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(fichaEmergencia));

    const access = makeJwt(3600);
    const response = await GET(getRequest("5", `${ACCESS_TOKEN_COOKIE}=${access}`), { params: { id: "5" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fichaEmergencia);

    const [url, init] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("http://localhost:8000/api/v1/fichas-medicas/persona/5/emergencia");
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe(`Bearer ${access}`);
  });

  it("passes through the backend's 403 when the role is not authorized", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ mensaje: "Permisos insuficientes para esta operación" }, 403),
    );

    const access = makeJwt(3600);
    const response = await GET(getRequest("5", `${ACCESS_TOKEN_COOKIE}=${access}`), { params: { id: "5" } });

    expect(response.status).toBe(403);
  });
});
