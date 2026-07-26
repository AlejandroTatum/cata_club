/**
 * Route Handler Tests — GET /api/members
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed
 * (same pattern as src/app/api/payments/__tests__/route.test.ts).
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
  return new NextRequest("http://localhost/api/members", { headers: cookie ? { cookie } : {} });
}

const persona = {
  id: 3,
  nombres: "Sofia",
  apellidos: "Alumna",
  telefono: "0999999003",
  fechaNacimiento: "1995-01-01",
  representanteId: null,
};

const pago = {
  id: 9,
  monto: "25.00",
  estadoPago: "APROBADO",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-07-01T10:00:00",
  fechaInicio: "2026-07-01",
  fechaFin: "2026-08-01",
  personaId: 3,
  personaNombreCompleto: "Sofia Alumna",
  membresiaId: 77,
};

const membresia = { id: 77, estado: "ACTIVA", tipoMembresiaId: 1 };

const tipo = { id: 1, categoria: "MENSUAL", franjaHoraria: "TARDE" };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/members", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("builds MemberAccount[] from personas + pagos + niveles", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse([])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse([])) // /ranking/niveles
      .mockResolvedValueOnce(jsonResponse({ items: [] })); // /membresias/?limit=200 (bulk)

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({ id: "3", role: "representante" });
    expect(body.personasCapped).toBe(false);
  });

  it("preserves the upstream cap when 200 personas collapse into fewer accounts", async () => {
    const personas = Array.from({ length: 200 }, (_, index) => ({
      ...persona,
      id: index + 1,
      representanteId: index === 0 ? null : 1,
    }));
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: personas, total: 200, skip: 0, limit: 200 }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].estudiantes).toHaveLength(199);
    expect(body.personasCapped).toBe(true);
  });

  it("propagates the backend's status and message when /personas/ fails", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 401));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.message).toBe("No autorizado");
  });

  it("resolves each membership by id, because GET /membresias/ answers 500", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [pago] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse([])) // /ranking/niveles
      .mockResolvedValueOnce(jsonResponse(membresia)); // /membresias/77

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    // The list endpoint is never called — it is the one that 500s.
    const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => /\/membresias\/\?/.test(url))).toBe(false);
    expect(urls).toContain("http://localhost:8000/api/v1/membresias/77");
    expect(body.accounts[0].estudiantes[0].membresia).toMatchObject({ estado: "activa" });
    expect(body.membresiasDegraded).toBe(false);
  });

  it("flags the response instead of reporting a membership-less student when the lookup fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [pago] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse([])) // /ranking/niveles
      .mockResolvedValueOnce(jsonResponse({ detail: "boom" }, 500)); // /membresias/77

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts[0].estudiantes[0].membresia).toBeNull();
    // Without this flag the page counts the null as "no active membership" and
    // renders a confident 0 — the contradiction this whole change removes.
    expect(body.membresiasDegraded).toBe(true);
  });

  it("finds a membership for a persona who has never paid", async () => {
    // Ana García's case: an ACTIVA membresía with zero Pago rows. Resolving
    // membership only through the payment chain reported her as having none,
    // while her own student portal said "Membresía activa".
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos — none at all
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse([])) // /ranking/niveles
      .mockResolvedValueOnce(jsonResponse([membresia])); // /membresias/persona/3

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("http://localhost:8000/api/v1/membresias/persona/3");
    expect(body.accounts[0].estudiantes[0].membresia).toMatchObject({ id: 77, estado: "activa" });
    // No payment, so no invented period and no fabricated payment row.
    expect(body.accounts[0].estudiantes[0].membresia.fechaInicio).toBe("");
    expect(body.accounts[0].estudiantes[0].ultimoPago).toBeNull();
    expect(body.membresiasDegraded).toBe(false);
  });

  it("degrades gracefully (empty pagos/tipos/niveles) when those calls fail", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ detail: "Forbidden" }, 403)) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse({ detail: "Forbidden" }, 403)) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ detail: "Forbidden" }, 403)) // /ranking/niveles
      .mockResolvedValueOnce(jsonResponse({ items: [] })); // /membresias/?limit=200 (bulk)

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts[0].estudiantes[0].membresia).toBeNull();
    expect(body.accounts[0].estudiantes[0].grupoId).toBeNull();
  });
});
