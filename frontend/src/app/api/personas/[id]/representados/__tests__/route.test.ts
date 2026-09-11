/**
 * Route Handler Tests — POST /api/personas/[id]/representados
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
  return new NextRequest(`http://localhost/api/personas/${id}/representados`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Issue #1138: no contactoEmergencia/telefonoEmergencia — a dependent
// created through this endpoint is always a represented minor, and the
// backend derives that contact from the representante at read time.
const validPayload = {
  nombres: "Juan",
  apellidos: "Pérez",
  cedula: "1712345678",
  fechaNacimiento: "2015-06-15",
  telefono: "0991234567",
  fichaMedica: {
    tipoSangre: "O_POSITIVO",
    enfermedades: ["Asma"],
    alergias: "Ninguna",
  },
};

const personaResponse = {
  id: 10,
  nombres: "Juan",
  apellidos: "Pérez",
  cedula: "1712345678",
  fechaNacimiento: "2015-06-15",
  telefono: "0991234567",
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

describe("POST /api/personas/[id]/representados", () => {
  it("returns 400 when the persona id is not a number", async () => {
    const response = await POST(postRequest("abc", validPayload), { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest("5", validPayload), { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /personas/{id}/representados with a snake_case body, including ficha_medica", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse, 201));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(personaResponse);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/representados",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          nombres: "Juan",
          apellidos: "Pérez",
          cedula: "1712345678",
          fecha_nacimiento: "2015-06-15",
          telefono: "0991234567",
          ficha_medica: {
            tipo_sangre: "O_POSITIVO",
            enfermedades: ["Asma"],
            alergias: "Ninguna",
          },
        }),
      }),
    );
  });

  it("omits ficha_medica from the backend body when not provided", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse, 201));
    const { fichaMedica: _fichaMedica, ...payloadWithoutFicha } = validPayload;

    const access = makeJwt(3600);
    await POST(
      postRequest("5", payloadWithoutFicha, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/representados",
      expect.objectContaining({
        body: JSON.stringify({
          nombres: "Juan",
          apellidos: "Pérez",
          cedula: "1712345678",
          fecha_nacimiento: "2015-06-15",
          telefono: "0991234567",
        }),
      }),
    );
  });

  it("propagates the backend's 403 (ownership mismatch)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "El persona_id de la URL no coincide con el token de acceso" }, 403),
    );

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(403);
  });

  it("propagates the backend's 422 for invalid medical fields", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Validation error" }, 422));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(422);
  });

  it("forwards institucionId to the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse, 201));
    const payloadWithInstitucion = { ...validPayload, institucionId: 3 };

    const access = makeJwt(3600);
    await POST(
      postRequest("5", payloadWithInstitucion, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/representados",
      expect.objectContaining({
        body: JSON.stringify({
          nombres: "Juan",
          apellidos: "Pérez",
          cedula: "1712345678",
          fecha_nacimiento: "2015-06-15",
          telefono: "0991234567",
          ficha_medica: {
            tipo_sangre: "O_POSITIVO",
            enfermedades: ["Asma"],
            alergias: "Ninguna",
          },
          institucion_id: 3,
        }),
      }),
    );
  });

  it("omits institucionId from the backend body when not provided", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse, 201));

    const access = makeJwt(3600);
    await POST(
      postRequest("5", validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    const [, options] = vi.mocked(global.fetch).mock.calls[0];
    const sentBody = JSON.parse((options as RequestInit).body as string) as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty("institucion_id");
  });

  /**
   * Issue #1137, invariante (B): a represented dependent never has a
   * `Usuario` of their own. `correo`/`contrasenia` used to be forwarded here
   * (FIC-2) so the backend's (now-retired) "Opción B" could create one —
   * a stray value with either name in the body must never reach the
   * backend anymore.
   */
  it("never forwards a stray correo/contrasenia in the body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse, 201));
    const payloadWithCredentials = {
      ...validPayload,
      correo: "hijo@cataclub.com",
      contrasenia: "alumno1234",
    };

    const access = makeJwt(3600);
    await POST(
      postRequest("5", payloadWithCredentials, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    const [, options] = vi.mocked(global.fetch).mock.calls[0];
    const sentBody = JSON.parse((options as RequestInit).body as string) as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty("correo");
    expect(sentBody).not.toHaveProperty("contrasenia");
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const access = makeJwt(3600);
    const request = new NextRequest("http://localhost/api/personas/5/representados", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${access}` },
      body: "not-json",
    });

    const response = await POST(request, { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
