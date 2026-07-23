/**
 * Route Handler Tests — GET/POST /api/attendance/records
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
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

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/attendance/records", { headers: cookie ? { cookie } : {} });
}

function postRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/attendance/records", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const asistencia = {
  id: 1,
  fechaEntrenamiento: "2026-07-18",
  fechaRegistro: "2026-07-18T16:26:55.036299",
  estado: "PRESENTE",
  justificativo: null,
  estadoJustificativo: null,
  personaId: 3,
  entrenadorId: 2,
  horarioId: 1,
};
const horario = { id: 1, diaSemana: "LUNES", horaInicio: "15:00:00", horaFin: "16:30:00", entrenadorId: 2 };
const personas = { items: [{ id: 3, nombres: "Sofia", apellidos: "Alumna" }, { id: 2, nombres: "Carla", apellidos: "Trainer" }] };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/attendance/records", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("translates backend Asistencias into AttendanceRecord[]", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse([asistencia]))
      .mockResolvedValueOnce(jsonResponse([horario]))
      .mockResolvedValueOnce(jsonResponse(personas));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      { id: "1", fecha: "2026-07-18", horario: "Lunes 15:00 — 16:30", personaId: 3, estudiante: "Sofia Alumna", estado: "present", entrenador: "Carla Trainer" },
    ]);
  });

  it("forwards fechaInicio/fechaFin as fecha_inicio/fecha_fin query params", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    const access = makeJwt(3600);
    const request = new NextRequest("http://localhost/api/attendance/records?fechaInicio=2026-07-18&fechaFin=2026-07-18", {
      headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` },
    });
    await GET(request);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/asistencias/reportes?fecha_inicio=2026-07-18&fecha_fin=2026-07-18",
      expect.anything(),
    );
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(503);
  });
});

describe("POST /api/attendance/records", () => {
  it("returns 400 for an invalid body", async () => {
    const access = makeJwt(3600);
    const response = await POST(postRequest({ horarioId: 1 }, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("issues one POST /asistencias/ per student and reports createdCount", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse(asistencia, 201))
      .mockResolvedValueOnce(jsonResponse({ ...asistencia, id: 2, personaId: 7 }, 201));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest(
        {
          horarioId: 1,
          entrenadorId: 2,
          fechaEntrenamiento: "2026-07-18",
          students: [
            { personaId: 3, estado: "present" },
            { personaId: 7, estado: "absent" },
          ],
        },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ createdCount: 2, failed: [] });
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/asistencias/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          fecha_entrenamiento: "2026-07-18",
          estado: "PRESENTE",
          persona_id: 3,
          entrenador_id: 2,
          horario_id: 1,
        }),
      }),
    );
  });

  it("tolerates partial failure — one bad persona doesn't fail the whole batch", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse(asistencia, 201))
      .mockResolvedValueOnce(jsonResponse({ detail: "Persona con id 99 no encontrada" }, 404));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest(
        {
          horarioId: 1,
          entrenadorId: 2,
          students: [
            { personaId: 3, estado: "present" },
            { personaId: 99, estado: "absent" },
          ],
        },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.createdCount).toBe(1);
    expect(body.failed).toEqual([{ personaId: 99, message: "Persona con id 99 no encontrada" }]);
  });

  it("returns 502 when every student fails to register", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ detail: "Horario no encontrado" }, 404));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest(
        { horarioId: 999, entrenadorId: 2, students: [{ personaId: 3, estado: "present" }] },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.createdCount).toBe(0);
  });
});
