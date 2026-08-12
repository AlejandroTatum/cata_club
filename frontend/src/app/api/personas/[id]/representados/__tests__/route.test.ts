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
    contactoEmergencia: "María Pérez",
    telefonoEmergencia: "0997654321",
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
    const response = await POST(postRequest("abc", validPayload), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest("5", validPayload), { params: { id: "5" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /personas/{id}/representados with a snake_case body, including ficha_medica", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse, 201));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
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
            contacto_emergencia: "María Pérez",
            telefono_emergencia: "0997654321",
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
      { params: { id: "5" } },
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
      { params: { id: "5" } },
    );

    expect(response.status).toBe(403);
  });

  it("propagates the backend's 422 for invalid medical fields", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Validation error" }, 422));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );

    expect(response.status).toBe(422);
  });

  it("forwards correo, contrasenia and institucionId to the backend (FIC-2)", async () => {
    // FIC-2: the wizard's credentials step builds these into
    // RepresentadoCreatePayload, the backend's RepresentadoCreateDTO accepts
    // them, and the API says 201 — but this route used to drop all three
    // before forwarding, so the minor's Usuario row was never created.
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse, 201));
    const payloadWithCredentials = {
      ...validPayload,
      correo: "hijo@cataclub.com",
      contrasenia: "alumno1234",
      institucionId: 3,
    };

    const access = makeJwt(3600);
    await POST(
      postRequest("5", payloadWithCredentials, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
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
            contacto_emergencia: "María Pérez",
            telefono_emergencia: "0997654321",
          },
          correo: "hijo@cataclub.com",
          contrasenia: "alumno1234",
          institucion_id: 3,
        }),
      }),
    );
  });

  it("omits correo/contrasenia/institucionId from the backend body when not provided", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(personaResponse, 201));

    const access = makeJwt(3600);
    await POST(
      postRequest("5", validPayload, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );

    const [, options] = vi.mocked(global.fetch).mock.calls[0];
    const sentBody = JSON.parse((options as RequestInit).body as string) as Record<string, unknown>;
    expect(sentBody).not.toHaveProperty("correo");
    expect(sentBody).not.toHaveProperty("contrasenia");
    expect(sentBody).not.toHaveProperty("institucion_id");
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    const access = makeJwt(3600);
    const request = new NextRequest("http://localhost/api/personas/5/representados", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${access}` },
      body: "not-json",
    });

    const response = await POST(request, { params: { id: "5" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
