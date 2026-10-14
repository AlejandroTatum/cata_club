/**
 * Route Handler Tests — GET /api/groups/horarios/[id]/alumnos
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

function getRequest(cookie = "", query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/groups/horarios/1/alumnos${query}`, {
    method: "GET",
    headers: cookie ? { cookie } : {},
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

describe("GET /api/groups/horarios/[id]/alumnos", () => {
  it("returns 401 when no access token cookie is present", async () => {
    const response = await GET(getRequest(), { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies GET /asistencias/horarios/{id}/alumnos with the bearer token", async () => {
    // Paginated backend (issue #7): the body is the standard envelope and the
    // proxy must pass it through untouched.
    const alumnos = {
      items: [
        {
          id: 10,
          persona_id: 3,
          persona_nombre_completo: "Sofia Martinez",
          horario_id: 1,
          horario_dia: "LUNES",
          horario_hora_inicio: "18:00",
          horario_hora_fin: "20:00",
          fecha_asignacion: "2026-07-01T00:00:00Z",
        },
      ],
      total: 1,
      skip: 0,
      limit: 50,
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(alumnos));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "1" }) });
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/horarios/1/alumnos",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${access}` }) }),
    );
    expect(response.status).toBe(200);
    expect(body).toEqual(alumnos);
  });

  it("targets a different horario id (triangulation)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([]));

    const access = makeJwt(3600);
    await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "7" }) });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/horarios/7/alumnos",
      expect.anything(),
    );
  });

  it("forwards skip and limit to the backend (issue #7)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ items: [], total: 0, skip: 10, limit: 200 }),
    );

    const access = makeJwt(3600);
    await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`, "?skip=10&limit=200"), {
      params: Promise.resolve({ id: "1" }),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/horarios/1/alumnos?skip=10&limit=200",
      expect.anything(),
    );
  });

  // S15: the roster's `bloqueado_por_impago` flag is judged on the session date.
  it("forwards the session date (fecha) to the backend unchanged", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ items: [], total: 0, skip: 0, limit: 200 }),
    );

    const access = makeJwt(3600);
    await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`, "?limit=200&fecha=2026-07-20"), {
      params: Promise.resolve({ id: "1" }),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/horarios/1/alumnos?limit=200&fecha=2026-07-20",
      expect.anything(),
    );
  });

  it("omits fecha when the caller sent none, so the backend defaults to today", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ items: [], total: 0, skip: 0, limit: 200 }),
    );

    const access = makeJwt(3600);
    await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`, "?limit=200"), {
      params: Promise.resolve({ id: "1" }),
    });

    const [url] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/api/v1/asistencias/horarios/1/alumnos?limit=200");
    expect(String(url)).not.toContain("fecha");
  });

  it("propagates backend errors", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ message: "No encontrado" }, 404));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "999" }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.message).toBe("No encontrado");
  });
});
