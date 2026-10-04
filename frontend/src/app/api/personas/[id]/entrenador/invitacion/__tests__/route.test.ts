/**
 * Route Handler Tests — POST /api/personas/[id]/entrenador/invitacion (#1575)
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

const COOKIE = `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

function postRequest(id: string, cookie = COOKIE): NextRequest {
  return new NextRequest(`http://localhost/api/personas/${id}/entrenador/invitacion`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/personas/[id]/entrenador/invitacion", () => {
  it("returns 400 when the persona id is not a number", async () => {
    const response = await POST(postRequest("abc"), ctx("abc"));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(postRequest("20", ""), ctx("20"));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies to the backend and turns its 204 into a JSON success", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const response = await POST(postRequest("20"), ctx("20"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/personas/20/entrenador/invitacion",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("relays the backend's message when the invitation was already used", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "Esta cuenta no tiene una invitación pendiente." }, 400),
    );

    const response = await POST(postRequest("20"), ctx("20"));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("invitación pendiente");
  });
});
