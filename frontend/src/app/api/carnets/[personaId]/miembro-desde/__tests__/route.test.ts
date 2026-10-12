/**
 * Route Handler Tests — PATCH /api/carnets/[personaId]/miembro-desde (issue #1749)
 *
 * The admin sets or clears one player's «Miembro desde». The browser sends the
 * month it picked (`YYYY-MM`) or `null`; the backend gets the first day of that
 * month. The backend is the authority on role, month range and "is a player":
 * its refusal reaches the screen verbatim.
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

function makeJwt(): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.sig`;
}

function patchRequest(body: unknown, withCookie = true): NextRequest {
  return new NextRequest("http://localhost/api/carnets/7/miembro-desde", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(withCookie ? { cookie: `${ACCESS_TOKEN_COOKIE}=${makeJwt()}` } : {}) },
    body: JSON.stringify(body),
  });
}

const params = (personaId: string) => ({ params: Promise.resolve({ personaId }) });

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("PATCH /api/carnets/[personaId]/miembro-desde", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await PATCH(patchRequest({ miembroDesde: "2019-03" }, false), params("7"));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([["abc"], ["0"], ["-3"]])("returns 400 for persona %j without calling the backend", async (id) => {
    const response = await PATCH(patchRequest({ miembroDesde: "2019-03" }), params(id));
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ miembroDesde: "marzo" }], [{ miembroDesde: "2019-13" }], [{ miembroDesde: "2019-03-15" }], [{ miembroDesde: 5 }]])(
    "returns 400 for body %j without calling the backend",
    async (body) => {
      const response = await PATCH(patchRequest(body), params("7"));
      expect(response.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it("sends the first day of the chosen month to the backend and relays the person", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ id: 7, miembroDesde: "2019-03-01" }));

    const response = await PATCH(patchRequest({ miembroDesde: "2019-03" }), params("7"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ miembroDesde: "2019-03-01" });
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toBe("http://localhost:8000/api/v1/personas/7/miembro-desde");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ miembro_desde: "2019-03-01" });
  });

  it("clears the value with an explicit null", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ id: 7, miembroDesde: null }));

    const response = await PATCH(patchRequest({ miembroDesde: null }), params("7"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ miembroDesde: null });
    expect(JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body))).toEqual({ miembro_desde: null });
  });

  it("relays the backend's refusal (not a player, future month, non-admin) with its own message", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ detail: "«Miembro desde» solo se registra para jugadores; esta persona no es jugadora." }, 400),
    );

    const response = await PATCH(patchRequest({ miembroDesde: "2019-03" }), params("7"));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/solo se registra para jugadores/);
  });
});
