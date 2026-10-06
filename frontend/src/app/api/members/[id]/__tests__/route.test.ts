/**
 * Route Handler Tests — GET /api/members/[id]
 *
 * The per-member payments page (#1668) loads ONE account by id instead of
 * draining every persona like `GET /api/members`, so a member the list never
 * showed (past the first page) is still reachable by direct URL.
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
  return `${header}.${base64Url(JSON.stringify({ sub: "1", exp }))}.sig`;
}

function getRequest(id: string, cookie = `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`http://localhost/api/members/${id}`, { headers: cookie ? { cookie } : {} }),
    { params: Promise.resolve({ id }) },
  ];
}

// Persona 450 is far beyond the first 200-row page of `GET /personas/`.
const persona = {
  id: 450,
  nombres: "Lucía",
  apellidos: "Vera",
  cedula: "1710034065",
  telefono: "0999999450",
  fechaNacimiento: "2012-01-01",
  representanteId: null,
  activo: true,
};
const pago = {
  id: 9,
  monto: "25.00",
  estadoPago: "PENDIENTE_VALIDACION",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-09-01T10:00:00",
  fechaInicio: "2026-09-01",
  fechaFin: "2026-10-01",
  personaId: 450,
  membresiaId: 77,
};
const membresia = { id: 77, estado: "VENCIDA", tipoMembresiaId: 1, personaId: 450 };

let routes: Record<string, () => Response>;

beforeEach(() => {
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  routes = {
    "/personas/450": () => jsonResponse(persona),
    "/membresias/persona/450": () => jsonResponse([membresia]),
    "/membresias/pagos/persona/450": () => jsonResponse([pago]),
    "/membresias/tipos": () => jsonResponse([{ id: 1, categoria: "MENSUAL" }]),
    "/fichas-medicas/existe": () => jsonResponse({ personaIdsConFicha: [] }),
    "/personas/roles/bulk": () => jsonResponse([{ personaId: 450, roles: ["ALUMNO"] }]),
    "/membresias/deuda/bulk": () =>
      jsonResponse([{ membresiaId: 77, mesesAdeudados: 2, ultimaCoberturaFin: "2026-08-31", montoMensual: "25.00" }]),
  };
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname.replace("/api/v1", "");
    const handler = routes[path];
    return handler ? handler() : jsonResponse({ detail: `unexpected ${path}` }, 500);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/members/[id]", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(...getRequest("450", ""));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // Guard: `/personas/roles/bulk` is ADMINISTRADOR-only in the backend, and the
  // three per-persona lookups below also answer to the persona themselves or
  // their representative — so a non-admin must stop at the 403, not get their
  // own account back through the admin screen's route.
  it.each([
    ["a player reading their own record", 403],
    ["a representative reading their child's record", 403],
  ])("answers 403 and returns no account for %s", async (_who, status) => {
    routes["/personas/roles/bulk"] = () => jsonResponse({ detail: "Permisos insuficientes" }, status);

    const response = await GET(...getRequest("450"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.account).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("Lucía");
  });

  it("answers 401 when the backend says the session is not valid", async () => {
    routes["/personas/roles/bulk"] = () => jsonResponse({ detail: "No autenticado" }, 401);

    const response = await GET(...getRequest("450"));

    expect(response.status).toBe(401);
    expect((await response.json()).account).toBeUndefined();
  });

  it("rejects a non-numeric id without calling the backend", async () => {
    const response = await GET(...getRequest("abc"));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("builds the one account by id, with its membership, last payment and derived debt, never listing every persona", async () => {
    const response = await GET(...getRequest("450"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.account).toMatchObject({
      id: "450",
      nombres: "Lucía",
      role: "estudiante",
      estudiantes: [
        {
          id: "450",
          activo: true,
          membresia: { id: 77, estado: "vencida", mesesAdeudados: 2, montoAdeudado: 50 },
          ultimoPago: { estado: "pendiente_validacion" },
        },
      ],
    });
    const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => /\/personas\/(\?|$)/.test(url))).toBe(false);
    expect(urls.some((url) => url.includes("/personas/450"))).toBe(true);
  });

  it("answers 404 with a plain message when the member does not exist", async () => {
    routes["/personas/450"] = () => jsonResponse({ detail: "Persona no encontrada" }, 404);

    const response = await GET(...getRequest("450"));

    expect(response.status).toBe(404);
    expect((await response.json()).message).toMatch(/no se encontró|no existe/i);
  });

  it("fails loudly when the memberships lookup fails, instead of showing a member with no membership", async () => {
    routes["/membresias/persona/450"] = () => jsonResponse({ detail: "boom" }, 500);

    const response = await GET(...getRequest("450"));

    expect(response.status).toBe(500);
    expect((await response.json()).account).toBeUndefined();
  });
});
