/**
 * Route Handler Tests — POST /api/auth/me/foto (self-service profile photo upload)
 *
 * Proxies backend POST /auth/me/foto: reads the incoming multipart/form-data
 * request, forwards the file to FastAPI via `backendFetchAuthed`, returns the
 * updated profile JSON. Mirrors the GET/PATCH /api/auth/me route tests'
 * structure (auth-cookie gating, backend-error passthrough).
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

function fotoRequest(archivo: File | null, cookie = ""): NextRequest {
  const formData = new FormData();
  if (archivo) formData.append("archivo", archivo);
  return new NextRequest("http://localhost/api/auth/me/foto", {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: formData,
  });
}

const perfil = {
  correo: "ana.torres@cataclub.com",
  personaId: 7,
  nombres: "Ana",
  apellidos: "Torres",
  roles: ["ENTRENADOR"],
  telefono: "0991234567",
  fechaCreacion: "2024-03-10T14:22:05.123456",
  fotoUrl: "https://res.cloudinary.com/test/image/upload/perfil-fake.jpg",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/auth/me/foto", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    const response = await POST(fotoRequest(archivo));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 without calling the backend when no file is attached", async () => {
    const access = makeJwt(3600);
    const response = await POST(fotoRequest(null, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the file to backend POST /auth/me/foto and returns the updated profile", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(perfil));

    const access = makeJwt(3600);
    const archivo = new File(["contenido"], "foto.jpg", { type: "image/jpeg" });
    const response = await POST(fotoRequest(archivo, `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(perfil);
    expect(body.fotoUrl).toBe(perfil.fotoUrl);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/auth/me/foto",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
  });

  it("propagates the backend's error status (e.g. unsupported file type)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Formato de archivo no permitido. Usa JPG o PNG" }, 400),
    );

    const access = makeJwt(3600);
    const archivo = new File(["contenido"], "archivo.pdf", { type: "application/pdf" });
    const response = await POST(fotoRequest(archivo, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(400);
  });
});
