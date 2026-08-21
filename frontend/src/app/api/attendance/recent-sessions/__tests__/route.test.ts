/**
 * Route Handler Tests — GET /api/attendance/recent-sessions
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

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

function getRequest(url: string, cookie = ""): NextRequest {
  return new NextRequest(url, { headers: cookie ? { cookie } : {} });
}

const ultimaLista = {
  horarioId: 1,
  fechaEntrenamiento: "2026-08-03",
  diaSemana: "LUNES",
  horaInicio: "15:00:00",
  horaFin: "16:30:00",
  presentes: 5,
  tardanzas: 1,
  justificados: 1,
  ausentes: 1,
  total: 8,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/attendance/recent-sessions", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest("http://localhost/api/attendance/recent-sessions"));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("translates BackendUltimaLista[] into RecentSession[], no author field", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([ultimaLista]));

    const access = makeJwt(3600);
    const response = await GET(
      getRequest("http://localhost/api/attendance/recent-sessions", `${ACCESS_TOKEN_COOKIE}=${access}`),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      {
        horarioId: 1,
        fecha: "2026-08-03",
        horario: "Lunes 15:00 — 16:30",
        counts: { present: 5, late: 1, justified: 1, absent: 1 },
        total: 8,
      },
    ]);
    // Sin autor a propósito (§8): la sesión no dice quién tomó la lista.
    expect(body[0]).not.toHaveProperty("entrenadorId");
    expect(body[0]).not.toHaveProperty("registradoPor");
  });

  it("forwards ?limit to the backend as-is", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([]));

    const access = makeJwt(3600);
    await GET(
      getRequest(
        "http://localhost/api/attendance/recent-sessions?limit=3",
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
    );

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/ultimas-listas?limit=3",
      expect.anything(),
    );
  });

  it("passes through a backend error", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await GET(
      getRequest("http://localhost/api/attendance/recent-sessions", `${ACCESS_TOKEN_COOKIE}=${access}`),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "No autorizado", mensaje_seguro: false });
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const access = makeJwt(3600);
    const response = await GET(
      getRequest("http://localhost/api/attendance/recent-sessions", `${ACCESS_TOKEN_COOKIE}=${access}`),
    );

    expect(response.status).toBe(503);
  });
});
