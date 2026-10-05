/**
 * Route Handler Tests — POST /api/auth/consentimiento-legal/aceptar (S8)
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

import { POST } from "../route";

const url = "http://localhost/api/auth/consentimiento-legal/aceptar";

describe("POST /api/auth/consentimiento-legal/aceptar", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await POST(new NextRequest(url, { method: "POST" }));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts to the backend with the caller's token and no body, relaying the new state", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ pendiente: false, version: "2.3" }), { status: 200 }),
    );
    const access = makeJwt();

    const response = await POST(
      new NextRequest(url, {
        method: "POST",
        headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` },
        body: JSON.stringify({ cuentaId: 99 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pendiente: false, version: "2.3" });
    const [target, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(target).toBe("http://localhost:8000/api/v1/auth/consentimiento-legal/aceptar");
    expect(init).toEqual(expect.objectContaining({ method: "POST" }));
    expect(init?.body).toBeUndefined();
  });
});
