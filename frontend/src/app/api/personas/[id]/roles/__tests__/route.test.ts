/**
 * Route Handler Tests — GET/POST/DELETE /api/personas/[id]/roles
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST, DELETE } from "../route";
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
  return new NextRequest(`http://localhost/api/personas/${id}/roles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(id: string, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}/roles`, {
    method: "GET",
    headers: cookie ? { cookie } : {},
  });
}

function deleteRequest(id: string, tipoRol: string | null, cookie = ""): NextRequest {
  const url = tipoRol ? `http://localhost/api/personas/${id}/roles?tipoRol=${tipoRol}` : `http://localhost/api/personas/${id}/roles`;
  return new NextRequest(url, {
    method: "DELETE",
    headers: cookie ? { cookie } : {},
  });
}

const rolesResponse = {
  personaId: 5,
  roles: ["ALUMNO", "ENTRENADOR"],
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

describe("GET /api/personas/[id]/roles", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest("5"), { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls GET /personas/{id}/roles and returns the current roles + activo without mutating anything", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(rolesResponse));

    const access = makeJwt(3600);
    const response = await GET(getRequest("5", `${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "5" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(rolesResponse);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/roles",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("propagates the backend's 403", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await GET(getRequest("5", `${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(403);
  });
});

describe("POST /api/personas/[id]/roles", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest("5", { tipoRol: "ENTRENADOR" }), { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /personas/{id}/roles with snake_case body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(rolesResponse, 201));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", { tipoRol: "ENTRENADOR" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(rolesResponse);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/roles",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tipo_rol: "ENTRENADOR" }),
      }),
    );
  });

  it("propagates the backend's 403", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest("5", { tipoRol: "ENTRENADOR" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/personas/[id]/roles", () => {
  it("returns 400 when tipoRol query param is missing", async () => {
    const access = makeJwt(3600);
    const response = await DELETE(deleteRequest("5", null, `${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /personas/{id}/roles/{tipo_rol} with Authorization: Bearer", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(rolesResponse));

    const access = makeJwt(3600);
    const response = await DELETE(
      deleteRequest("5", "ENTRENADOR", `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(rolesResponse);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/personas/5/roles/ENTRENADOR",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
  });

  it("propagates the backend's 403", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await DELETE(
      deleteRequest("5", "ENTRENADOR", `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(403);
  });
});
