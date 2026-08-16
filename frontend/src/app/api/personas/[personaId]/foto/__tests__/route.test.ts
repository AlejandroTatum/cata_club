/**
 * Route Handler Tests — POST /api/personas/[personaId]/foto
 *
 * Proxies backend POST /personas/{persona_id}/foto: reads the incoming
 * multipart/form-data request, forwards the file to FastAPI via
 * `backendFetchAuthed`, returns the updated Persona JSON. Mirrors
 * `auth/me/foto/__tests__/route.test.ts` (auth-cookie gating, backend-error
 * passthrough) plus the `[personaId]` path validation used by the sibling
 * personas routes.
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

function fotoRequest(personaId: string, archivo: File | null, cookie = ""): NextRequest {
  const formData = new FormData();
  if (archivo) formData.append("archivo", archivo);
  return new NextRequest(`http://localhost/api/personas/${personaId}/foto`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: formData,
  });
}

const persona = {
  id: 42,
  nombres: "Sofía",
  apellidos: "Vera",
  cedula: "1710034065",
  fechaNacimiento: "2014-01-01",
  fotoUrl: "https://res.cloudinary.com/test/image/upload/perfil-fake.jpg",
  telefono: "0991234567",
  representanteId: 9,
  activo: true,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/personas/[personaId]/foto", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    const response = await POST(fotoRequest("42", archivo), { params: { personaId: "42" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 without calling the backend when personaId is not numeric", async () => {
    const access = makeJwt(3600);
    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    const response = await POST(fotoRequest("abc", archivo, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { personaId: "abc" },
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 without calling the backend when no file is attached", async () => {
    const access = makeJwt(3600);
    const response = await POST(fotoRequest("42", null, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { personaId: "42" },
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the file to backend POST /personas/42/foto and returns the updated persona", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(persona));

    const access = makeJwt(3600);
    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    const response = await POST(fotoRequest("42", archivo, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { personaId: "42" },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(persona);
    expect(body.fotoUrl).toBe(persona.fotoUrl);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/42/foto",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
  });

  it("propagates the backend's error status (e.g. unsupported file type)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Formato de archivo no permitido. Use JPG o PNG" }, 400),
    );

    const access = makeJwt(3600);
    const archivo = new File(["contenido"], "archivo.pdf", { type: "application/pdf" });
    const response = await POST(fotoRequest("42", archivo, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { personaId: "42" },
    });

    expect(response.status).toBe(400);
  });
});
