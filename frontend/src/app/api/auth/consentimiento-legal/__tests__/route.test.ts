/**
 * Route Handler Tests — GET /api/auth/consentimiento-legal (S8)
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "ana@cataclub.com", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.sig`;
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

import { GET } from "../route";

const url = "http://localhost/api/auth/consentimiento-legal";

describe("GET /api/auth/consentimiento-legal", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's pending state using the caller's bearer token", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ pendiente: true, version: "2.3" }), { status: 200 }),
    );
    const access = makeJwt();

    const response = await GET(new NextRequest(url, { headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` } }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pendiente: true, version: "2.3" });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/consentimiento-legal",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${access}` }) }),
    );
  });
});
