/**
 * Route Handler Tests — GET /api/carnets?ids=1,2,3 (issue #1670)
 *
 * The admin's carnet data: for each persona, the SAME profile `/api/student`
 * builds (so the card is the one the player sees) plus the assignments the
 * card's "Franja" row reads. Admin-only, enforced here and not only by the page.
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

const cookie = () => `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;

function getRequest(url: string, withCookie = true): NextRequest {
  return new NextRequest(url, { headers: withCookie ? { cookie: cookie() } : {} });
}

const tipo = { id: 1, categoria: "Mensual", precio: "85.00", modalidad: "MENSUAL" };

function persona(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    nombres: `Jugador${id}`,
    apellidos: "Prueba",
    telefono: "0999999999",
    fechaNacimiento: "2012-01-01",
    representanteId: null,
    ...extra,
  };
}

function portalBody(id: number) {
  return {
    titular: {
      persona: persona(id, { cedula: `11500000${id}` }),
      representante: null,
      historial: [],
      membresias: [
        { id: id * 10, estado: "ACTIVA", personaId: id, montoAplicado: "85.00", tipoMembresiaId: 1, cubiertoHasta: "2026-12-31" },
      ],
    },
    representados: [{ persona: persona(900 + id), representante: null, historial: [], membresias: [] }],
    horarios: [],
    tipos: [tipo],
  };
}

/** Backend double: `/auth/me` with the given roles, the portal, and the assignments. */
function mockBackend(
  roles: string[],
  missing: number[] = [],
  horariosFail: Record<number, "500" | "network"> = {},
): void {
  vi.mocked(global.fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/auth/me")) {
      return jsonResponse({ correo: "x@y.z", personaId: 1, nombres: "A", apellidos: "B", roles });
    }
    const portal = url.match(/\/portal\/alumno\/(\d+)/);
    if (portal) {
      const id = Number(portal[1]);
      return missing.includes(id) ? jsonResponse({ detail: "nope" }, 404) : jsonResponse(portalBody(id));
    }
    const horarios = url.match(/\/asistencias\/alumnos\/(\d+)\/horarios/);
    if (horarios) {
      const failure = horariosFail[Number(horarios[1])];
      if (failure === "500") return jsonResponse({ detail: "boom" }, 500);
      if (failure === "network") throw new TypeError("fetch failed");
      return jsonResponse([{ id: 1, personaId: Number(horarios[1]), horarioDia: "LUNES" }]);
    }
    return jsonResponse({}, 500);
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

describe("GET /api/carnets", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest("http://localhost/api/carnets?ids=5", false));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([["ALUMNO"], ["ENTRENADOR"], ["REPRESENTANTE"], ["ALUMNO", "REPRESENTANTE"]])(
    "refuses a non-admin (%s) and never reads another person's portal",
    async (...roles) => {
      mockBackend(roles);
      const response = await GET(getRequest("http://localhost/api/carnets?ids=5,6"));
      expect(response.status).toBe(403);
      const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("/portal/alumno"))).toBe(false);
      expect(urls.some((url) => url.includes("/horarios"))).toBe(false);
    },
  );

  it.each([[""], ["abc"], ["0"], ["5,-1"], ["5,x"]])("returns 400 for ids=%j", async (ids) => {
    mockBackend(["ADMINISTRADOR"]);
    const response = await GET(getRequest(`http://localhost/api/carnets?ids=${ids}`));
    expect(response.status).toBe(400);
  });

  it("returns 400 above the per-request cap", async () => {
    mockBackend(["ADMINISTRADOR"]);
    const ids = Array.from({ length: 61 }, (_, index) => index + 1).join(",");
    const response = await GET(getRequest(`http://localhost/api/carnets?ids=${ids}`));
    expect(response.status).toBe(400);
  });

  it("gives an admin each persona's own profile, coverage and assignments, in the order asked", async () => {
    mockBackend(["ADMINISTRADOR"]);
    const response = await GET(getRequest("http://localhost/api/carnets?ids=7,5,7"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.carnets.map((entry: { profile: { personaId: string } }) => entry.profile.personaId)).toEqual(["7", "5"]);
    expect(body.carnets[0].profile).toMatchObject({ nombres: "Jugador7", cedula: "115000007", fotoUrl: null });
    expect(body.carnets[0].profile.membership).toMatchObject({ categoria: "Mensual" });
    expect(body.carnets[0].coverageEnd).toBe("2026-12-31");
    expect(body.carnets[0].asignaciones).toEqual([{ id: 1, personaId: 7, horarioDia: "LUNES" }]);
    expect(body.missing).toEqual([]);
    // The card is the persona's, never a represented person's (portal `titular` only).
    expect(JSON.stringify(body)).not.toContain("Jugador907");
  });

  it("reports a persona it could not read instead of failing the whole sheet", async () => {
    mockBackend(["ADMINISTRADOR"], [6]);
    const response = await GET(getRequest("http://localhost/api/carnets?ids=5,6"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.carnets).toHaveLength(1);
    expect(body.missing).toEqual([6]);
  });

  it("reports a persona whose schedule fails to load (500) instead of printing empty days", async () => {
    mockBackend(["ADMINISTRADOR"], [], { 6: "500" });
    const response = await GET(getRequest("http://localhost/api/carnets?ids=5,6"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.carnets.map((entry: { profile: { personaId: string } }) => entry.profile.personaId)).toEqual(["5"]);
    expect(body.missing).toEqual([6]);
  });

  it("reports a persona whose schedule request dies on the network, and still serves the rest", async () => {
    mockBackend(["ADMINISTRADOR"], [], { 5: "network" });
    const response = await GET(getRequest("http://localhost/api/carnets?ids=5,6"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.carnets.map((entry: { profile: { personaId: string } }) => entry.profile.personaId)).toEqual(["6"]);
    expect(body.missing).toEqual([5]);
  });
});
