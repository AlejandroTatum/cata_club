/** @vitest-environment node */

/**
 * Contract tests for the tariff-edit BFF route (issue #394, inside #400).
 *
 * This route carries the number the club charges with, so its contract gets
 * the same treatment as the discounts one it mirrors: an id that is not a
 * number never reaches the backend, an empty body is rejected before the
 * trip, and a backend refusal is relayed with its own message instead of
 * being flattened into a generic 500.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function base64Url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  );
  return `${header}.${payload}.sig`;
}

function patchRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/membresias/tipos/1", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const TOKEN = () => `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;

describe("PATCH /api/membresias/tipos/[id]", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("returns 401 without an access-token cookie", async () => {
    const response = await PATCH(patchRequest({ precio: "40.00" }), { params: { id: "1" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-numeric id without calling the backend", async () => {
    const response = await PATCH(patchRequest({ precio: "40.00" }, TOKEN()), {
      params: { id: "abc" },
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const request = new NextRequest("http://localhost/api/membresias/tipos/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie: TOKEN() },
      body: "{no-json",
    });

    const response = await PATCH(request, { params: { id: "1" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the body carries none of the updatable fields", async () => {
    const response = await PATCH(patchRequest({ otraCosa: 1 }, TOKEN()), {
      params: { id: "1" },
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards only the updatable fields to the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ id: 1, categoria: "Adultos", precio: "40.00", modalidad: "MENSUAL" }),
    );

    const response = await PATCH(
      patchRequest({ precio: "40.00", id: 99, montoAplicado: 7 }, TOKEN()),
      { params: { id: "1" } },
    );

    expect(response.status).toBe(200);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain("/membresias/tipos/1");
    expect((init as RequestInit).method).toBe("PATCH");
    // `id` viaja en la URL y `montoAplicado` no es de este recurso: ninguno
    // de los dos puede colarse en el cuerpo hacia el backend.
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ precio: "40.00" });
  });

  it("relays the backend message when the backend refuses", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ detail: "Tipo de membresía con id 1 no encontrado" }, 404),
    );

    const response = await PATCH(patchRequest({ precio: "40.00" }, TOKEN()), {
      params: { id: "1" },
    });

    expect(response.status).toBe(404);
    expect((await response.json()).message).toContain("no encontrado");
  });

  it("relays a 403 from the backend instead of flattening it", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ detail: "No tiene permisos suficientes" }, 403),
    );

    const response = await PATCH(patchRequest({ precio: "40.00" }, TOKEN()), {
      params: { id: "1" },
    });

    expect(response.status).toBe(403);
  });
});
