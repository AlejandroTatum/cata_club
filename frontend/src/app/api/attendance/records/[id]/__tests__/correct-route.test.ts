/**
 * Route Handler Tests — PATCH /api/attendance/records/[id]/correct
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — same pattern as
 * src/app/api/payments/__tests__/id-route.test.ts. Covers input validation,
 * the snake_case translation onto `PATCH /asistencias/{id}/corregir`, the
 * camelCase response translation (including the nested `asistencia` through
 * `buildAttendanceRecord`), and error propagation.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PATCH } from "../correct/route";
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

function patchRequest(body: unknown, cookie: string | null = `${ACCESS_TOKEN_COOKIE}=${validAccess}`): NextRequest {
  return new NextRequest("http://localhost/api/attendance/records/501/correct", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

const validBody = { estado: "present", motivo: "Se confirmó presencia con el profesor." };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("PATCH /api/attendance/records/[id]/correct — input validation", () => {
  it("returns 400 for a non-numeric id without calling the backend", async () => {
    const response = await PATCH(patchRequest(validBody), { params: { id: "abc" } });
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON", async () => {
    const request = new NextRequest("http://localhost/api/attendance/records/501/correct", {
      method: "PATCH",
      body: "not json {",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${validAccess}` },
    });
    const response = await PATCH(request, { params: { id: "501" } });
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown estado", async () => {
    const response = await PATCH(patchRequest({ ...validBody, estado: "bogus" }), { params: { id: "501" } });
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when motivo is empty", async () => {
    const response = await PATCH(patchRequest({ estado: "present", motivo: "   " }), { params: { id: "501" } });
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await PATCH(patchRequest(validBody, null), { params: { id: "501" } });
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/attendance/records/[id]/correct — success", () => {
  it("PATCHes /asistencias/{id}/corregir snake_case and translates the camelCase response", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({
        asistencia: {
          id: 501,
          fechaEntrenamiento: "2026-07-20",
          fechaRegistro: "2026-07-20T18:00:00Z",
          estado: "PRESENTE",
          justificativo: null,
          estadoJustificativo: null,
          personaId: 9,
          personaNombreCompleto: "Ana López",
          horarioId: 11,
          registradoPorId: 3,
          registradoPorNombre: "Coach Torres",
        },
        corregidoPorId: 1,
        corregidoPorNombre: "Admin Demo",
        corregidoEn: "2026-08-18T12:00:00Z",
        motivo: "Se confirmó presencia con el profesor.",
        estadoAnterior: "AUSENTE",
        justificativoAnterior: null,
        estadoJustificativoAnterior: null,
      }),
    );

    const response = await PATCH(patchRequest(validBody), { params: { id: "501" } });
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/501/corregir",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          estado: "PRESENTE",
          justificativo: null,
          estado_justificativo: null,
          motivo: "Se confirmó presencia con el profesor.",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(body.asistencia.id).toBe("501");
    expect(body.asistencia.estado).toBe("present");
    expect(body.corregidoPorNombre).toBe("Admin Demo");
    expect(body.estadoAnterior).toBe("absent");
  });
});

describe("PATCH /api/attendance/records/[id]/correct — error propagation", () => {
  it("propagates a 400 past the correction window from the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "No se puede corregir una asistencia de hace más de 30 días." }, 400),
    );
    const response = await PATCH(patchRequest(validBody), { params: { id: "501" } });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.message).toContain("30 días");
  });

  it("returns 404 when the backend reports the row doesn't exist", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Asistencia no encontrada" }, 404));
    const response = await PATCH(patchRequest(validBody), { params: { id: "999" } });
    expect(response.status).toBe(404);
  });
});
