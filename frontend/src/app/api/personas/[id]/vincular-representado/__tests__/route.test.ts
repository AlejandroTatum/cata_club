/**
 * Route Handler Tests — POST /api/personas/[id]/vincular-representado (INS-2)
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";
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

function postRequest(id: string, body: unknown, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}/vincular-representado`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const personaResponse = {
  id: 10,
  nombres: "Lucas",
  apellidos: "Vega",
  cedula: "1723456789",
  fechaNacimiento: "2015-06-15",
  telefono: "0991234567",
  representanteId: 5,
};

const MENSAJE_GENERICO = "No fue posible vincular esa cédula a su cuenta. Verifique el número e intente nuevamente.";

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/personas/[id]/vincular-representado", () => {
  it("returns 400 when the persona id is not a number", async () => {
    const response = await POST(postRequest("abc", { cedula: "1723456789" }), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest("5", { cedula: "1723456789" }), { params: { id: "5" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body has no cedula string", async () => {
    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", { cedula: 123 }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const access = makeJwt(3600);
    const request = new NextRequest("http://localhost/api/personas/5/vincular-representado", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${access}` },
      body: "not-json",
    });

    const response = await POST(request, { params: { id: "5" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /personas/{id}/vincular-representado with the cedula, on the caller's own id", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse, 200));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", { cedula: "1723456789" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(personaResponse);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/vincular-representado",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ cedula: "1723456789" }),
      }),
    );
  });

  it("propagates the backend's 403 (ownership mismatch)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "El persona_id de la URL no coincide con el token de acceso" }, 403),
    );

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", { cedula: "1723456789" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );

    expect(response.status).toBe(403);
  });

  // Anti-enumeration (guardarraíl 3, docs/product/decisiones-de-negocio-2026-08-11.md
  // §1): the BFF must relay the backend's generic 400 VERBATIM, for a
  // nonexistent cédula and for an ineligible-but-existing one alike — it
  // must not rewrite, summarize, or otherwise touch that message.
  it.each([
    ["a nonexistent cédula", "cedula inexistente"],
    ["an existing but ineligible cédula", "persona no elegible"],
  ])("propagates the backend's generic 400 verbatim for %s", async (_label, _reason) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: MENSAJE_GENERICO }, 400));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", { cedula: "1799999999" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe(MENSAJE_GENERICO);
  });

  it("propagates the backend's 429 when the attempt throttle trips", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Too Many Requests" }, 429));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", { cedula: "1799999999" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );

    expect(response.status).toBe(429);
  });
});
