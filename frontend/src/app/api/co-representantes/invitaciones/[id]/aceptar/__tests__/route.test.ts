/**
 * Route Handler Tests — POST /api/co-representantes/invitaciones/[id]/aceptar
 *
 * @vitest-environment node
 */

import { POST } from "../route";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const COOKIE = `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

function postRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/co-representantes/invitaciones/7/aceptar", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/co-representantes/invitaciones/[id]/aceptar", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest(), ctx("7"));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric id without calling the backend", async () => {
    const response = await POST(postRequest(COOKIE), ctx("abc"));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts the invitation and answers 204", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const response = await POST(postRequest(COOKIE), ctx("7"));

    expect(response.status).toBe(204);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/co-representantes/invitaciones/7/aceptar",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("forwards the 404 of someone else's invitation", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Invitación no encontrada" }, 404));

    const response = await POST(postRequest(COOKIE), ctx("7"));

    expect(response.status).toBe(404);
  });
});
