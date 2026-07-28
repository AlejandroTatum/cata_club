/**
 * Route Handler Tests — GET /api/student
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed
 * (same pattern as src/app/api/members/__tests__/route.test.ts).
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

const self = {
  id: 5,
  nombres: "Sofia",
  apellidos: "Alumna",
  telefono: "0999999005",
  fechaNacimiento: "1995-01-01",
  representanteId: null,
};

const child = {
  id: 6,
  nombres: "Mateo",
  apellidos: "Alumno",
  telefono: "0999999006",
  fechaNacimiento: "2015-01-01",
  representanteId: 5,
};

const perfilDisponible = {
  personaId: 5,
  nivelRankingId: 1,
  nivelRankingNombre: "Intermedios",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/student", () => {
  it("returns 400 when personaId is missing or invalid", async () => {
    const response = await GET(getRequest("http://localhost/api/student"));
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest("http://localhost/api/student?personaId=5"));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("builds a self-only portal (no representados) with ranking and attendance", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse([])) // /personas/5/representados
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/horarios
      .mockResolvedValueOnce(jsonResponse([{ id: 1, categoria: "Mensual", franjaHoraria: "Tarde", precio: "85.00", modalidad: "MENSUAL" }])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse(self)) // /personas/5
      .mockResolvedValueOnce(jsonResponse(perfilDisponible)) // /ranking/5/perfil
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/persona/5
      .mockResolvedValueOnce(jsonResponse([{ id: 4, estado: "ACTIVA", personaId: 5, montoAplicado: "85.00", tipoMembresiaId: 1 }])); // /membresias/mias?persona_id=5

    const access = makeJwt(3600);
    const response = await GET(getRequest("http://localhost/api/student?personaId=5", `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.representados).toHaveLength(0);
    expect(body.self).toMatchObject({
      personaId: "5",
      nombres: "Sofia",
      ranking: { status: "available", nivelNombre: "Intermedios" },
    });
    expect(body.self.membership).toMatchObject({ estado: "ACTIVA", categoria: "Mensual", modalidad: "MENSUAL" });
    expect(body.membershipPlans).toEqual([{ id: "1", nombre: "Mensual", precio: 85, franjaHoraria: "Tarde", modalidad: "MENSUAL" }]);
  });

  it("marks a representado's ranking as unavailable/forbidden when the backend returns 403", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse([child])) // /personas/5/representados
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/horarios
      .mockResolvedValueOnce(jsonResponse([])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse(self)) // /personas/5
      .mockResolvedValueOnce(jsonResponse(perfilDisponible)) // /ranking/5/perfil
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/persona/5
      .mockResolvedValueOnce(jsonResponse([])) // /membresias/mias?persona_id=5
      .mockResolvedValueOnce(jsonResponse(child)) // /personas/6
      .mockResolvedValueOnce(jsonResponse({ detail: "No puede consultar el perfil de ranking de otra persona" }, 403)) // /ranking/6/perfil
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/persona/6
      .mockResolvedValueOnce(jsonResponse([])); // /membresias/mias?persona_id=6

    const access = makeJwt(3600);
    const response = await GET(getRequest("http://localhost/api/student?personaId=5", `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.representados).toHaveLength(1);
    expect(body.representados[0]).toMatchObject({
      personaId: "6",
      ranking: { status: "unavailable", reason: "forbidden" },
    });
  });

  it("fetches memberships per persona (self + each representado), each getting its own", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse([child])) // /personas/5/representados
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/horarios
      .mockResolvedValueOnce(jsonResponse([])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse(self)) // /personas/5
      .mockResolvedValueOnce(jsonResponse(perfilDisponible)) // /ranking/5/perfil
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/persona/5
      .mockResolvedValueOnce(jsonResponse([{ id: 4, estado: "ACTIVA", personaId: 5, montoAplicado: "40.00", tipoMembresiaId: 1 }])) // /membresias/mias?persona_id=5
      .mockResolvedValueOnce(jsonResponse(child)) // /personas/6
      .mockResolvedValueOnce(jsonResponse({ ...perfilDisponible, personaId: 6 })) // /ranking/6/perfil
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/persona/6
      .mockResolvedValueOnce(jsonResponse([{ id: 7, estado: "ACTIVA", personaId: 6, montoAplicado: "25.00", tipoMembresiaId: 1 }])); // /membresias/mias?persona_id=6

    const access = makeJwt(3600);
    const response = await GET(getRequest("http://localhost/api/student?personaId=5", `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.self.membership).toMatchObject({ estado: "ACTIVA" });
    expect(body.representados[0].membership).toMatchObject({ estado: "ACTIVA" });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/membresias/mias?persona_id=6"),
      expect.anything(),
    );
  });

  it("propagates the backend's status and message when /personas/{id}/representados fails", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 401));

    const access = makeJwt(3600);
    const response = await GET(getRequest("http://localhost/api/student?personaId=5", `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.message).toBe("No autorizado");
  });

  it("returns self: null when the self persona lookup itself fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse([])) // /personas/5/representados
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/horarios
      .mockResolvedValueOnce(jsonResponse([])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ detail: "No encontrado" }, 404)) // /personas/5
      .mockResolvedValueOnce(jsonResponse(perfilDisponible)) // /ranking/5/perfil
      .mockResolvedValueOnce(jsonResponse([])) // /asistencias/persona/5
      .mockResolvedValueOnce(jsonResponse([])); // /membresias/mias?persona_id=5 (called but persona fetch failed first)

    const access = makeJwt(3600);
    const response = await GET(getRequest("http://localhost/api/student?personaId=5", `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.self).toBeNull();
  });
});
