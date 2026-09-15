/**
 * Route Handler Tests — POST /api/personas/[id]/independizar (#1137)
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
  correo: "adulto@cataclub.com",
  contrasenia: "unaClaveSegura1",
  evidenciaIdentidad: "Cédula verificada en el mostrador",
};

function postRequest(
  id: string,
  body: unknown,
  { cookie = "", idempotencyKey }: { cookie?: string; idempotencyKey?: string } = {},
): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}/independizar`, {
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
  persona_id: 20,
  representante_anterior_id: 5,
  usuario_id: 42,
  cuenta_creada: true,
  replay: false,
  idempotency_key: "clave-independencia-1",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/personas/[id]/independizar", () => {
  it("returns 400 when the persona id is not a number", async () => {
    const response = await POST(postRequest("abc", VALID_BODY), { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest("20", VALID_BODY), { params: Promise.resolve({ id: "20" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const access = makeJwt(3600);
    const request = new NextRequest("http://localhost/api/personas/20/independizar", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${access}` },
      body: "not-json",
    });

    const response = await POST(request, { params: Promise.resolve({ id: "20" }) });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["correo", { ...VALID_BODY, correo: "" }],
    ["contrasenia", { ...VALID_BODY, contrasenia: "" }],
    ["evidenciaIdentidad", { ...VALID_BODY, evidenciaIdentidad: "" }],
  ])("returns 400 when %s is missing", async (_field, body) => {
    const access = makeJwt(3600);
    const response = await POST(
      postRequest("20", body, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "20" }) },
    );

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the admin payload in snake_case and the caller's Idempotency-Key", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(BACKEND_RESPONSE, 200));

    const access = makeJwt(3600);
    await POST(
      postRequest("20", VALID_BODY, {
        cookie: `${ACCESS_TOKEN_COOKIE}=${access}`,
        idempotencyKey: "clave-del-cliente",
      }),
      { params: Promise.resolve({ id: "20" }) },
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/20/independizar",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          correo: VALID_BODY.correo,
          contrasenia: VALID_BODY.contrasenia,
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
      postRequest("20", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "20" }) },
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Idempotency-Key")).toBeTruthy();
  });

  it("translates the backend's snake_case response into the client's camelCase shape", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(BACKEND_RESPONSE, 200));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("20", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "20" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      personaId: 20,
      representanteAnteriorId: 5,
      usuarioId: 42,
      cuentaCreada: true,
      replay: false,
      idempotencyKey: "clave-independencia-1",
    });
  });

  it("propagates the backend's 403 (role gate)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Permisos insuficientes para esta operación" }, 403),
    );

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("20", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "20" }) },
    );

    expect(response.status).toBe(403);
  });

  it("propagates the backend's 409 verbatim (idempotency key reused with a different request)", async () => {
    const MENSAJE =
      "La clave de idempotencia ya fue usada por otro comando. Genere una clave nueva para este intento.";
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: MENSAJE }, 409));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("20", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "20" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.message).toBe(MENSAJE);
  });

  it("propagates the backend's 400 verbatim (business rule, e.g. a minor is rejected)", async () => {
    const MENSAJE = "No se puede independizar a una persona menor de edad.";
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: MENSAJE }, 400));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("20", VALID_BODY, { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` }),
      { params: Promise.resolve({ id: "20" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe(MENSAJE);
  });
});
