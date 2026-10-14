/**
 * Route Handler Tests — GET /api/student/attendance
 *
 * One page of a persona's attendance history, past the recent window the
 * portal aggregate carries. Wraps the paginated `GET /asistencias/persona/{id}`.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";
import {
  fetchedUrls,
  jsonResponse,
  meBody,
  portalBody,
  routeFetch,
} from "@/lib/server/__tests__/payment-block-fixtures";

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function cookie(): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${ACCESS_TOKEN_COOKIE}=${header}.${payload}.sig`;
}

function getRequest(url: string, withCookie = true): NextRequest {
  return new NextRequest(url, { headers: withCookie ? { cookie: cookie() } : {} });
}

const asistencia = (id: number, fecha: string, estado = "PRESENTE") => ({
  id, fechaEntrenamiento: fecha, fechaRegistro: `${fecha}T10:00:00Z`, estado, personaId: 5,
  personaNombreCompleto: "Sofia Alumna", horarioId: 3,
});
const horario = { id: 3, diaSemana: "JUEVES", horaInicio: "15:00:00", horaFin: "16:00:00" };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/student/attendance", () => {
  it("rejects a missing persona or invalid paging without calling the backend", async () => {
    for (const url of [
      "http://localhost/api/student/attendance?skip=0&limit=30",
      "http://localhost/api/student/attendance?personaId=5&skip=-1&limit=30",
      "http://localhost/api/student/attendance?personaId=5&skip=0&limit=0",
    ]) {
      expect((await GET(getRequest(url))).status).toBe(400);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest("http://localhost/api/student/attendance?personaId=5&skip=0&limit=30", false));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards skip/limit to the persona's history and returns labelled sessions with the total", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5 })),
      "/asistencias/persona/5": jsonResponse({
        items: [asistencia(2, "2026-06-18", "ATRASADO"), asistencia(1, "2026-06-11")],
        total: 95, skip: 30, limit: 30,
      }),
      "/asistencias/horarios": jsonResponse([horario]),
    });

    const response = await GET(getRequest("http://localhost/api/student/attendance?personaId=5&skip=30&limit=30"));
    const body = await response.json();

    expect(response.status).toBe(200);
    const urls = fetchedUrls();
    expect(urls.some((u) => u.includes("/asistencias/persona/5?skip=30&limit=30"))).toBe(true);
    expect(body.total).toBe(95);
    expect(body.items).toEqual([
      { fecha: "2026-06-18", horario: expect.stringContaining("15:00"), estado: "late" },
      { fecha: "2026-06-11", horario: expect.stringContaining("15:00"), estado: "present" },
    ]);
  });

  it("passes a backend refusal through instead of an empty page", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5 })),
      "/portal/alumno/5": jsonResponse(portalBody({ id: 5 })),
      "/asistencias/persona/9": jsonResponse({ detail: "No puedes consultar el historial de asistencia de otra persona" }, 403),
      "/asistencias/horarios": jsonResponse([horario]),
    });

    const response = await GET(getRequest("http://localhost/api/student/attendance?personaId=9&skip=0&limit=30"));

    expect(response.status).toBe(403);
  });
});

/**
 * #1779 S4 — a profile blocked for non-payment gets only Payments. The portal's
 * client-side gate is a redirect; this is the server side of it, so the history
 * is not reachable by typing the URL or calling the BFF directly.
 */
describe("GET /api/student/attendance — non-payment block (#1779 S4)", () => {
  const url = (personaId: number) => `http://localhost/api/student/attendance?personaId=${personaId}&skip=0&limit=30`;
  const history = jsonResponse({ items: [asistencia(1, "2026-06-11")], total: 1, skip: 0, limit: 30 });
  const horarios = jsonResponse([horario]);

  it("denies a blocked player their own history with 403 and a machine-readable code, before touching it", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["ESTUDIANTE"], bloqueadoPorImpago: true })),
      "/asistencias/": history,
    });

    const response = await GET(getRequest(url(5)));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ codigo: "bloqueo_impago", message: expect.any(String) });
    expect(fetchedUrls().some((u) => u.includes("/asistencias/"))).toBe(false);
  });

  it("denies a guardian the history of the dependent the backend flags as blocked", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["REPRESENTANTE"] })),
      "/portal/alumno/5": jsonResponse(portalBody({ id: 5 }, [{ id: 6, bloqueadoPorImpago: true }, { id: 7 }])),
      "/asistencias/": history,
    });

    const response = await GET(getRequest(url(6)));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ codigo: "bloqueo_impago" });
    expect(fetchedUrls().some((u) => u.includes("/asistencias/"))).toBe(false);
  });

  it("still serves the guardian's other dependent, and the guardian's own history", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["REPRESENTANTE"] })),
      "/portal/alumno/5": jsonResponse(portalBody({ id: 5 }, [{ id: 6, bloqueadoPorImpago: true }, { id: 7 }])),
      "/asistencias/persona/": history,
      "/asistencias/horarios": horarios,
    });

    expect((await GET(getRequest(url(7)))).status).toBe(200);
    expect((await GET(getRequest(url(5)))).status).toBe(200);
  });

  it.each(["ADMINISTRADOR", "ENTRENADOR"])(
    "never restricts staff: a %s whose own membership lapsed still reads any history",
    async (role) => {
      routeFetch({
        "/auth/me": jsonResponse(meBody({ personaId: 1, roles: [role], bloqueadoPorImpago: true })),
        "/asistencias/persona/": history,
        "/asistencias/horarios": horarios,
      });

      expect((await GET(getRequest(url(6)))).status).toBe(200);
      expect(fetchedUrls().some((u) => u.includes("/portal/"))).toBe(false);
    },
  );

  it("fails closed when the caller cannot be resolved", async () => {
    routeFetch({
      "/auth/me": jsonResponse({ detail: "boom" }, 500),
      "/asistencias/": history,
    });

    const response = await GET(getRequest(url(5)));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(fetchedUrls().some((u) => u.includes("/asistencias/"))).toBe(false);
  });
});
