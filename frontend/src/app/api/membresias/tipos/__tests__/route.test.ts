/** @vitest-environment node */

/**
 * Contract tests for the tariff-create BFF route (issue #507).
 *
 * Mirrors `tipos/[id]/__tests__/route.test.ts` (the PATCH sibling): a missing
 * required field never reaches the backend, and a backend refusal is relayed
 * with its own message instead of being flattened into a generic 500.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
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

function postRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/membresias/tipos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const TOKEN = () => `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;

describe("POST /api/membresias/tipos", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("returns 401 without an access-token cookie", async () => {
    const response = await POST(
      postRequest({ categoria: "Adultos", precio: "40.00", modalidad: "MENSUAL" }),
    );

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const request = new NextRequest("http://localhost/api/membresias/tipos", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: TOKEN() },
      body: "{no-json",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["categoria", { precio: "40.00", modalidad: "MENSUAL" }],
    ["precio", { categoria: "Adultos", modalidad: "MENSUAL" }],
    ["modalidad", { categoria: "Adultos", precio: "40.00" }],
  ])("returns 400 when %s is missing, without calling the backend", async (_field, body) => {
    const response = await POST(postRequest(body, TOKEN()));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards categoria, precio and modalidad to the backend and returns 201", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ id: 3, categoria: "Adultos", precio: "40.00", modalidad: "MENSUAL" }, 201),
    );

    const response = await POST(
      postRequest({ categoria: "Adultos", precio: "40.00", modalidad: "MENSUAL" }, TOKEN()),
    );

    expect(response.status).toBe(201);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toContain("/membresias/tipos");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      categoria: "Adultos",
      precio: "40.00",
      modalidad: "MENSUAL",
    });
  });

  it("relays the backend message when the backend refuses (e.g. invalid price)", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ detail: "El precio debe ser mayor a 0" }, 422),
    );

    const response = await POST(
      postRequest({ categoria: "Adultos", precio: "0", modalidad: "MENSUAL" }, TOKEN()),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).message).toContain("mayor a 0");
  });

  it("relays a 403 from the backend instead of flattening it", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ detail: "No tiene permisos suficientes" }, 403),
    );

    const response = await POST(
      postRequest({ categoria: "Adultos", precio: "40.00", modalidad: "MENSUAL" }, TOKEN()),
    );

    expect(response.status).toBe(403);
  });
});
