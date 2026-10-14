/**
 * Route Handler Tests — GET /api/student
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed
 * (same pattern as src/app/api/members/__tests__/route.test.ts).
 *
 * Issue #1592: the route makes ONE upstream call (`/portal/alumno/{id}`); the
 * response shape sent to the browser is unchanged.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";
import { fetchedUrls, jsonResponse, meBody, routeFetch } from "@/lib/server/__tests__/payment-block-fixtures";

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

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

const access = () => makeJwt(3600);
const cookie = () => `${ACCESS_TOKEN_COOKIE}=${access()}`;

const tipo = { id: 1, categoria: "Mensual", precio: "85.00", modalidad: "MENSUAL" };

function perfil(persona: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { persona, representante: null, historial: [], membresias: [], ...extra };
}

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

  it("builds a self-only portal with ONE upstream call", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        titular: perfil(self, {
          membresias: [{ id: 4, estado: "ACTIVA", personaId: 5, montoAplicado: "85.00", tipoMembresiaId: 1 }],
        }),
        representados: [],
        horarios: [],
        tipos: [tipo],
      }),
    );

    const response = await GET(getRequest("http://localhost/api/student?personaId=5", cookie()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("/portal/alumno/5");
    expect(Number(url.match(/historial_limite=(\d+)/)![1])).toBeGreaterThanOrEqual(30); // RECENT_SESSIONS_LIMIT
    expect(body.representados).toHaveLength(0);
    expect(body.self).toMatchObject({ personaId: "5", nombres: "Sofia" });
    expect(body.self.membership).toMatchObject({ estado: "ACTIVA", categoria: "Mensual", modalidad: "MENSUAL" });
    expect(body.membershipPlans).toEqual([{ id: "1", nombre: "Mensual", precio: 85, modalidad: "MENSUAL", periodicidad: "MENSUAL" }]);
    expect(Object.keys(body).sort()).toEqual(["membershipPlans", "representados", "self"]);
  });

  it("gives self and each representado its own membership and representante from the single payload", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        titular: perfil(self, {
          membresias: [{ id: 4, estado: "ACTIVA", personaId: 5, montoAplicado: "40.00", tipoMembresiaId: 1 }],
        }),
        representados: [
          perfil(child, {
            representante: { nombres: "Sofia", apellidos: "Alumna" },
            membresias: [{ id: 7, estado: "ACTIVA", personaId: 6, montoAplicado: "25.00", tipoMembresiaId: 1 }],
          }),
        ],
        horarios: [],
        tipos: [tipo],
      }),
    );

    const response = await GET(getRequest("http://localhost/api/student?personaId=5", cookie()));
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(body.self.membership).toMatchObject({ estado: "ACTIVA" });
    expect(body.representados).toHaveLength(1);
    expect(body.representados[0]).toMatchObject({
      personaId: "6",
      representante: { nombres: "Sofia", apellidos: "Alumna" },
      representanteId: 5,
    });
    expect(body.representados[0].membership).toMatchObject({ estado: "ACTIVA" });
  });

  it("propagates the backend's status and message when the aggregate call fails", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 401));

    const response = await GET(getRequest("http://localhost/api/student?personaId=5", cookie()));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.message).toBe("No autorizado");
  });

  it("builds recentSessions from the historial using the horarios in the same payload", async () => {
    const asistencia = {
      id: 1,
      fechaEntrenamiento: "2026-07-01",
      estado: "PRESENTE",
      justificativo: null,
      estadoJustificativo: null,
      personaId: 5,
      horarioId: 1,
    };
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        titular: perfil(self, { historial: [asistencia] }),
        representados: [],
        horarios: [],
        tipos: [],
      }),
    );

    const response = await GET(getRequest("http://localhost/api/student?personaId=5", cookie()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.self.recentSessions).toHaveLength(1);
    expect(body.self.recentSessions[0]).toMatchObject({ fecha: "2026-07-01", estado: "present" });
  });

  it("blocks only the dependent the backend flags, leaving the account holder untouched (#1768)", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["REPRESENTANTE"] })),
      "/portal/alumno/5": jsonResponse({
        titular: perfil(self, { bloqueadoPorImpago: false, cubiertoHasta: null }),
        representados: [perfil(child, { bloqueadoPorImpago: true, cubiertoHasta: "2026-09-30" })],
        horarios: [],
        tipos: [tipo],
      }),
    });

    const response = await GET(getRequest("http://localhost/api/student?personaId=5", cookie()));
    const body = await response.json();

    expect(body.self).toMatchObject({ bloqueadoPorImpago: false, cubiertoHasta: null });
    expect(body.representados[0]).toMatchObject({ bloqueadoPorImpago: true, cubiertoHasta: "2026-09-30" });
  });

});

/**
 * #1779 S4 — the portal aggregate must not hand a blocked profile's attendance
 * to a non-staff caller. What Payments needs (identity, membership, the block
 * flag, the coverage end) stays, so a guardian still reaches the child's Payments.
 */
describe("GET /api/student — non-payment block (#1779 S4)", () => {
  const sesion = (id: number, personaId: number) => ({
    id, fechaEntrenamiento: "2026-06-11", fechaRegistro: "2026-06-11T10:00:00Z", estado: "PRESENTE",
    personaId, personaNombreCompleto: "N A", horarioId: 3,
  });
  const horario = { id: 3, diaSemana: "JUEVES", horaInicio: "15:00:00", horaFin: "16:00:00" };
  const membresia = (id: number, personaId: number) => ({
    id, estado: "VENCIDA", personaId, montoAplicado: "25.00", tipoMembresiaId: 1,
  });
  const aggregate = () => ({
    titular: perfil(self, { historial: [sesion(1, 5)], membresias: [membresia(4, 5)] }),
    representados: [
      perfil(child, {
        historial: [sesion(2, 6), sesion(3, 6)],
        historialTotal: 2,
        membresias: [membresia(7, 6)],
        bloqueadoPorImpago: true,
        cubiertoHasta: "2026-09-30",
      }),
    ],
    horarios: [horario],
    tipos: [tipo],
  });
  const request = () => getRequest("http://localhost/api/student?personaId=5", cookie());

  it("withholds a blocked dependent's attendance from the guardian but keeps what Payments reads", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["REPRESENTANTE"] })),
      "/portal/alumno/5": jsonResponse(aggregate()),
    });

    const body = await (await GET(request())).json();

    expect(body.representados[0]).toMatchObject({
      personaId: "6",
      bloqueadoPorImpago: true,
      cubiertoHasta: "2026-09-30",
      membership: { estado: "VENCIDA" },
      recentSessions: [],
      historialTotal: 0,
    });
    // The guardian's own profile is not blocked: nothing of it is withheld.
    expect(body.self.recentSessions).toHaveLength(1);
  });

  it("withholds a blocked player's own attendance from them", async () => {
    const own = aggregate();
    own.titular = perfil(self, { historial: [sesion(1, 5)], bloqueadoPorImpago: true, cubiertoHasta: "2026-09-30" });
    own.representados = [];
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["ESTUDIANTE"], bloqueadoPorImpago: true })),
      "/portal/alumno/5": jsonResponse(own),
    });

    const body = await (await GET(request())).json();

    expect(body.self).toMatchObject({ bloqueadoPorImpago: true, recentSessions: [], historialTotal: 0 });
  });

  it("never restricts staff reading a portal, even a lapsed admin's own", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 1, roles: ["ADMINISTRADOR"], bloqueadoPorImpago: true })),
      "/portal/alumno/5": jsonResponse(aggregate()),
    });

    const body = await (await GET(request())).json();

    expect(body.representados[0].recentSessions).toHaveLength(2);
    expect(body.representados[0].historialTotal).toBe(2);
  });

  it("fails closed when the caller cannot be resolved", async () => {
    routeFetch({
      "/auth/me": jsonResponse({ detail: "boom" }, 500),
      "/portal/alumno/5": jsonResponse(aggregate()),
    });

    const body = await (await GET(request())).json();

    expect(body.representados[0].recentSessions).toEqual([]);
  });

  it("asks who the caller is only when some profile is blocked", async () => {
    const unblocked = aggregate();
    unblocked.representados[0] = perfil(child, { historial: [sesion(2, 6)], membresias: [membresia(7, 6)] });
    routeFetch({ "/portal/alumno/5": jsonResponse(unblocked) });

    const body = await (await GET(request())).json();

    expect(body.representados[0].recentSessions).toHaveLength(1);
    expect(fetchedUrls().some((u) => u.includes("/auth/me"))).toBe(false);
  });
});
