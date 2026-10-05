/**
 * Route Handler Tests — PUT /api/personas/[id]/socio-desde (QA round 2, L15)
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUT } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const TOKEN = () => {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${ACCESS_TOKEN_COOKIE}=${header}.${payload}.sig`;
};

function putRequest(body: unknown, cookie = TOKEN()): NextRequest {
  return new NextRequest("http://localhost/api/personas/5/socio-desde", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = (id = "5") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("PUT /api/personas/[id]/socio-desde", () => {
  it("translates the body to snake_case and proxies PUT", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ fechaInicioClub: "2019-03-15" }));

    const response = await PUT(putRequest({ fechaInicioClub: "2019-03-15" }), ctx());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fechaInicioClub: "2019-03-15" });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/personas/5/socio-desde",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ fecha_inicio_club: "2019-03-15" }) }),
    );
  });

  it("returns 401 without calling the backend when there is no session", async () => {
    const response = await PUT(putRequest({ fechaInicioClub: "2019-03-15" }, ""), ctx());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric id, malformed JSON and a malformed date with 400", async () => {
    expect((await PUT(putRequest({ fechaInicioClub: "2019-03-15" }), ctx("abc"))).status).toBe(400);
    expect((await PUT(putRequest("{nope"), ctx())).status).toBe(400);
    expect((await PUT(putRequest({ fechaInicioClub: "15/03/2019" }), ctx())).status).toBe(400);
    expect((await PUT(putRequest({}), ctx())).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's 422 future-date message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "La fecha de socio no puede ser futura.", message: "La fecha de socio no puede ser futura." }, 422),
    );

    const response = await PUT(putRequest({ fechaInicioClub: "2099-01-01" }), ctx());

    expect(response.status).toBe(422);
    expect((await response.json()).message).toBe("La fecha de socio no puede ser futura.");
  });

  it("relays the backend's 403 for a non-admin", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Sin permiso" }, 403));

    const response = await PUT(putRequest({ fechaInicioClub: "2019-03-15" }), ctx());

    expect(response.status).toBe(403);
  });
});
