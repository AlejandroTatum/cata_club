/**
 * Route Handler Tests — GET /api/attendance/records/[id]/corrections
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — same pattern as the
 * sibling `.../correct` route test. Covers input validation, the
 * estadoAnterior enum translation, ordering passthrough, and error
 * propagation.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../corrections/route";
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

const validAccess = makeJwt(3600);

function getRequest(cookie: string | null = `${ACCESS_TOKEN_COOKIE}=${validAccess}`): NextRequest {
  return new NextRequest("http://localhost/api/attendance/records/501/corrections", {
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

describe("GET /api/attendance/records/[id]/corrections", () => {
  it("returns 400 for a non-numeric id without calling the backend", async () => {
    const response = await GET(getRequest(), { params: { id: "abc" } });
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest(null), { params: { id: "501" } });
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches /asistencias/{id}/correcciones and translates estadoAnterior, most-recent-first as received", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse([
        {
          id: 2,
          corregidoPorId: 1,
          corregidoPorNombre: "Admin Demo",
          corregidoEn: "2026-08-18T12:00:00Z",
          motivo: "Segunda corrección",
          estadoAnterior: "PRESENTE",
          justificativoAnterior: null,
          estadoJustificativoAnterior: null,
        },
        {
          id: 1,
          corregidoPorId: 1,
          corregidoPorNombre: "Admin Demo",
          corregidoEn: "2026-08-10T12:00:00Z",
          motivo: "Primera corrección",
          estadoAnterior: "AUSENTE",
          justificativoAnterior: null,
          estadoJustificativoAnterior: null,
        },
      ]),
    );

    const response = await GET(getRequest(), { params: { id: "501" } });
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/501/correcciones",
      expect.anything(),
    );
    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ id: 2, estadoAnterior: "present", motivo: "Segunda corrección" });
    expect(body[1]).toMatchObject({ id: 1, estadoAnterior: "absent", motivo: "Primera corrección" });
  });

  it("returns 403 when the backend refuses a non-admin", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Permisos insuficientes" }, 403));
    const response = await GET(getRequest(), { params: { id: "501" } });
    expect(response.status).toBe(403);
  });
});
