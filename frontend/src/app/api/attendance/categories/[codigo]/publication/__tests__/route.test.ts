/**
 * Route Handler Tests — PATCH /api/attendance/categories/[codigo]/publication
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed
 * (same pattern as ../__tests__/route.test.ts for the catalog GET).
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PATCH } from "../route";
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

function patchRequest(
  codigo: string,
  body: unknown,
  cookie = "",
): NextRequest {
  return new NextRequest(`http://localhost/api/attendance/categories/${codigo}/publication`, {
    method: "PATCH",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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

describe("PATCH /api/attendance/categories/[codigo]/publication", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await PATCH(patchRequest("FORMATIVO", { visible: false }), {
      params: Promise.resolve({ codigo: "FORMATIVO" }),
    });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the boolean to the backend's publicacion endpoint with Bearer auth", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ codigo: "FORMATIVO", label: "Formativo", visible: false }),
    );

    const access = makeJwt(3600);
    const response = await PATCH(patchRequest("FORMATIVO", { visible: false }, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: Promise.resolve({ codigo: "FORMATIVO" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/asistencias/categorias/FORMATIVO/publicacion",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
        body: JSON.stringify({ visible: false }),
      }),
    );
    expect(body).toHaveProperty("visible", false);
  });

  it("URL-encodes the codigo in the backend path", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ codigo: "PRE INFANTIL" }));

    const access = makeJwt(3600);
    await PATCH(patchRequest("PRE%20INFANTIL", { visible: true }, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: Promise.resolve({ codigo: "PRE INFANTIL" }),
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/asistencias/categorias/PRE%20INFANTIL/publicacion",
      expect.objectContaining({ body: JSON.stringify({ visible: true }) }),
    );
  });

  it("rejects a body whose visible is not a boolean with a 400, before calling the backend", async () => {
    const access = makeJwt(3600);
    const response = await PATCH(patchRequest("FORMATIVO", { visible: "sí" }, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: Promise.resolve({ codigo: "FORMATIVO" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(body.message).toContain("visible");
  });

  it("rejects a body with no visible field at all", async () => {
    const access = makeJwt(3600);
    const response = await PATCH(patchRequest("FORMATIVO", {}, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: Promise.resolve({ codigo: "FORMATIVO" }),
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's 404 for an unknown código", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Categoría NOEXISTE no encontrada" }, 404));

    const access = makeJwt(3600);
    const response = await PATCH(patchRequest("NOEXISTE", { visible: false }, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: Promise.resolve({ codigo: "NOEXISTE" }),
    });
    const body = await response.json();

    // The BFF's error translator replaces raw backend `detail` with its own
    // safe sentence (the same contract every sibling route relies on), so
    // the assertion is the relayed STATUS plus a message, not the detail.
    expect(response.status).toBe(404);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });
});
