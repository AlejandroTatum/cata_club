/**
 * Route Handler Tests — POST /api/personas/[id]/reasignar-representante (#1133/#1137)
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

const VALID_BODY = {
  nuevoRepresentanteId: 40,
  representanteActualId: 30,
  evidenciaIdentidad: "Cédula verificada en el mostrador",
};

function postRequest(
  id: string,
  body: unknown,
  { cookie = "", idempotencyKey }: { cookie?: string; idempotencyKey?: string } = {},
): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}/reasignar-representante`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

const BACKEND_RESPONSE = {
  persona_id: 24,
  representante_anterior_id: 30,
  representante_nuevo_id: 40,
  replay: false,
  idempotency_key: "clave-reasignacion-1",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/personas/[id]/reasignar-representante", () => {
  it("returns 400 when the persona id is not a number", async () => {
    const response = await POST(postRequest("abc", VALID_BODY), { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest("24", VALID_BODY), { params: Promise.resolve({ id: "24" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const access = makeJwt(3600);
    const request = new NextRequest("http://localhost/api/personas/24/reasignar-representante", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${access}` },
      body: "not-json",
    });

    const response = await POST(request, { params: Promise.resolve({ id: "24" }) });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["nuevoRepresentanteId", { ...VALID_BODY, nuevoRepresentanteId: undefined }],
    ["representanteActualId", { ...VALID_BODY, representanteActualId: undefined }],
    ["evidenciaIdentidad", { ...VALID_BODY, evidenciaIdentidad: "" }],
  ])("returns 400 when %s is missing", async (_field, body) => {
    const access = makeJwt(3600);
    const response = await POST(
      postRequest("24", body, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "24" }) },
    );

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the admin payload in snake_case and the caller's Idempotency-Key", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(BACKEND_RESPONSE, 200));

    const access = makeJwt(3600);
    await POST(
      postRequest("24", VALID_BODY, {
        cookie: `${ACCESS_TOKEN_COOKIE}=${access}`,
        idempotencyKey: "clave-del-cliente",
      }),
      { params: Promise.resolve({ id: "24" }) },
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/24/reasignar-representante",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          nuevo_representante_id: VALID_BODY.nuevoRepresentanteId,
          representante_actual_id: VALID_BODY.representanteActualId,
          evidencia_identidad: VALID_BODY.evidenciaIdentidad,
        }),
      }),
    );
    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("clave-del-cliente");
  });

  it("mints an Idempotency-Key when the client sends none", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(BACKEND_RESPONSE, 200));

    const access = makeJwt(3600);
    await POST(
      postRequest("24", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "24" }) },
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBeTruthy();
  });

  it("translates the backend's snake_case response into the client's camelCase shape", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(BACKEND_RESPONSE, 200));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("24", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "24" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      personaId: 24,
      representanteAnteriorId: 30,
      representanteNuevoId: 40,
      replay: false,
      idempotencyKey: "clave-reasignacion-1",
    });
  });

  it("propagates the backend's 403 (role gate)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Permisos insuficientes para esta operación" }, 403),
    );

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("24", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "24" }) },
    );

    expect(response.status).toBe(403);
  });

  it("propagates the backend's 409 verbatim (stale observed link)", async () => {
    const MENSAJE =
      "El vínculo de representación cambió desde que se abrió el trámite: recargue la ficha y reintente.";
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: MENSAJE }, 409));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("24", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "24" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.message).toBe(MENSAJE);
  });

  it("propagates the backend's 422 verbatim (domain rule, e.g. destination without the role)", async () => {
    const MENSAJE = "Esta cuenta no tiene el rol de Representante y no puede recibir representados.";
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: MENSAJE }, 422));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("24", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "24" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.message).toBe(MENSAJE);
  });

  it("returns 404 when the target persona does not exist", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Persona con id 999999 no encontrada" }, 404),
    );

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("999999", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "999999" }) },
    );

    expect(response.status).toBe(404);
  });
});
