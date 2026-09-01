/**
 * Route Handler Tests — GET /api/attendance/categories
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed
 * (same pattern as src/app/api/attendance/schedules/__tests__/route.test.ts).
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

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/attendance/categories", { headers: cookie ? { cookie } : {} });
}

const categoriaFormativo = {
  codigo: "FORMATIVO",
  label: "Formativo",
  horaInicio: "15:00:00",
  horaFin: "16:00:00",
  dias: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"],
  edades: "5 a 10 años",
};

const categoriaCompetitivo = {
  codigo: "COMPETITIVO",
  label: "Competitivo",
  horaInicio: "18:00:00",
  horaFin: "20:00:00",
  dias: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"],
  edades: null,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/attendance/categories", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /asistencias/categorias with Authorization: Bearer", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([]));

    const access = makeJwt(3600);
    await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/asistencias/categorias",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${access}` }) }),
    );
  });

  it("translates the backend CategoriaResponseDTO into the frontend shape (dias as DiaSemana[])", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([categoriaFormativo, categoriaCompetitivo]));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      {
        codigo: "FORMATIVO",
        label: "Formativo",
        horaInicio: "15:00",
        horaFin: "16:00",
        dias: ["lun", "mar", "mie", "jue", "vie"],
        edades: "5 a 10 años",
      },
      {
        codigo: "COMPETITIVO",
        label: "Competitivo",
        horaInicio: "18:00",
        horaFin: "20:00",
        dias: ["lun", "mar", "mie", "jue", "vie", "sab"],
        edades: null,
      },
    ]);
  });

  // `edades` is optional end to end (#789): a categoría without an ages label
  // is a legitimate state, and the DTO may omit the key entirely rather than
  // send an explicit null. Both collapse to `null` here so every catalog entry
  // has the same shape — consumers never have to tell "absent" from "cleared".
  it("carries a missing edades through as null (triangulation on the optional label)", async () => {
    const { edades: _omitted, ...sinEdades } = categoriaFormativo;
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([sinEdades]));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[0]).toHaveProperty("edades", null);
  });

  it("propagates the backend's status and message when /asistencias/categorias fails", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.message).toBe("No autorizado");
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(503);
  });
});
