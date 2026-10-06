/**
 * Route Handler Tests — DELETE /api/co-representantes/persona/[id]
 *
 * @vitest-environment node
 */

import { DELETE } from "../route";
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

function deleteRequest(id: string, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/co-representantes/persona/${id}`, {
    method: "DELETE",
    headers: cookie ? { cookie } : {},
  });
}

describe("DELETE /api/co-representantes/persona/[id]", () => {
  it("returns 400 when the persona id is not a number", async () => {
    const response = await DELETE(deleteRequest("abc"), { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await DELETE(deleteRequest("10"), { params: Promise.resolve({ id: "10" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("deletes through the backend and answers 204", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));

    const response = await DELETE(deleteRequest("10", COOKIE), { params: Promise.resolve({ id: "10" }) });

    expect(response.status).toBe(204);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/co-representantes/persona/10",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("forwards a 403 (not the primary guardian) untouched", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Solo el representante principal" }, 403));

    const response = await DELETE(deleteRequest("10", COOKIE), { params: Promise.resolve({ id: "10" }) });

    expect(response.status).toBe(403);
  });
});
